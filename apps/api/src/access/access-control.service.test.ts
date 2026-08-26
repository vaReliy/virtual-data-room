import { randomUUID } from 'node:crypto';

import { GoneException, NotFoundException } from '@nestjs/common';
import { createShareBodySchema } from '@dr/contracts';
import { beforeEach, describe, expect, it } from 'vitest';

import type { UserRecord, UserRepository } from '../modules/auth/user.repository';
import type { DataRoomRepository } from '../modules/data-room/data-room.repository';
import type { NodeRepository, NodeRecord } from '../modules/node/node.repository';
import { NodeService } from '../modules/node/node.service';
import { hashShareToken } from '../modules/share/share-token';
import type { ShareRecord, ShareRepository } from '../modules/share/share.repository';
import { AccessControlService } from './access-control.service';

/**
 * Scope resolution, against mocked repositories and no database.
 *
 * Every case here is a property that fails **silently**: a wrong answer is a request that
 * succeeds and serves somebody else's documents, or hides documents the caller was given.
 * None of them throws on its own, which is why they are pinned rather than reviewed.
 *
 * The fakes below implement the *contract* of each repository — in particular, "live"
 * means not revoked and not expired, in one place, exactly as the real queries express it.
 * The SQL itself is the repository's concern and is covered by the integration tests.
 */

const ROOM = randomUUID();
const OWNER = randomUUID();
const GRANTEE = randomUUID();
const GRANTEE_EMAIL = 'grantee@example.com';

/** `/legal/` contains `/legal/nda/`; `/finance/` sits beside it, and must stay invisible. */
const LEGAL = randomUUID();
const NDA = randomUUID();
const FINANCE = randomUUID();

const NODE_PATHS: Record<string, string | undefined> = {
  [LEGAL]: `/${LEGAL}/`,
  [NDA]: `/${LEGAL}/${NDA}/`,
  [FINANCE]: `/${FINANCE}/`,
};

/** Paths are built from UUIDs, so depth and string length agree — which is what the
 * broadest-grant comparison relies on. */
function pathOf(nodeId: string): string {
  const path = NODE_PATHS[nodeId];
  if (path === undefined) throw new Error(`No fixture path for ${nodeId}.`);
  return path;
}

type StoredShare = ShareRecord & { tokenHash: string | null };

interface World {
  user: UserRecord | null;
  shares: StoredShare[];
  deletedNodes: Set<string>;
}

function share(overrides: Partial<StoredShare> = {}): StoredShare {
  return {
    id: randomUUID(),
    dataRoomId: ROOM,
    nodeId: LEGAL,
    mode: 'USER',
    role: 'VIEWER',
    granteeEmail: GRANTEE_EMAIL,
    expiresAt: null,
    revokedAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    tokenHash: null,
    ...overrides,
  };
}

function isLive(row: StoredShare): boolean {
  return row.revokedAt === null && (row.expiresAt === null || row.expiresAt.getTime() > Date.now());
}

function serviceFor(world: World): AccessControlService {
  const dataRooms = {
    findOwnedById: (ownerId: string, dataRoomId: string) =>
      Promise.resolve(
        ownerId === OWNER && dataRoomId === ROOM
          ? { id: ROOM, name: 'Project Falcon', totalSize: 0, fileCount: 0, folderCount: 0 }
          : null,
      ),
  } as unknown as DataRoomRepository;

  const shares = {
    findLiveGrantsForEmail: (dataRoomId: string, email: string) =>
      Promise.resolve(
        world.shares.filter(
          (row) =>
            row.dataRoomId === dataRoomId &&
            row.mode === 'USER' &&
            row.granteeEmail === email &&
            isLive(row),
        ),
      ),
    findLiveByTokenHash: (tokenHash: string) =>
      Promise.resolve(
        world.shares.find((row) => row.tokenHash === tokenHash && isLive(row)) ?? null,
      ),
  } as unknown as ShareRepository;

  const nodes = {
    // Deliberately returns deleted rows, like the real statement.
    findGrantNodeInRoom: (dataRoomId: string, nodeId: string) =>
      Promise.resolve(
        dataRoomId === ROOM && NODE_PATHS[nodeId] !== undefined
          ? {
              id: nodeId,
              path: pathOf(nodeId),
              deletedAt: world.deletedNodes.has(nodeId) ? new Date() : null,
            }
          : null,
      ),
  } as unknown as NodeRepository;

  const users = {
    findById: (userId: string) => Promise.resolve(userId === GRANTEE ? world.user : null),
  } as unknown as UserRepository;

  return new AccessControlService(dataRooms, shares, nodes, users);
}

describe('AccessControlService', () => {
  let world: World;

  beforeEach(() => {
    world = {
      user: {
        id: GRANTEE,
        email: GRANTEE_EMAIL,
        emailVerified: true,
        name: 'Grantee',
        avatarUrl: null,
      },
      shares: [],
      deletedNodes: new Set(),
    };
  });

  it('scopes an owner to the whole room', async () => {
    const scope = await serviceFor(world).resolveForUser(OWNER, ROOM);

    expect(scope.role).toBe('OWNER');
    expect(scope.rootPath).toBe('/');
    expect(scope.rootNodeId).toBeNull();
  });

  it('scopes a granted folder to that folder, as a VIEWER', async () => {
    world.shares = [share({ nodeId: LEGAL })];

    const scope = await serviceFor(world).resolveForUser(GRANTEE, ROOM);

    expect(scope.role).toBe('VIEWER');
    expect(scope.rootNodeId).toBe(LEGAL);
    expect(scope.rootPath).toBe(pathOf(LEGAL));
  });

  /**
   * The security requirement behind decision #7. Without it, registering an account on
   * somebody else's address is enough to inherit whatever was shared with them — and the
   * failure is invisible, because the request simply succeeds.
   */
  it('refuses a grant when the session email is unverified', async () => {
    world.user = { ...world.user!, emailVerified: false };
    world.shares = [share()];

    await expect(serviceFor(world).resolveForUser(GRANTEE, ROOM)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  /**
   * Both sides of the comparison are normalized by the same declaration: the address the
   * owner typed goes through `createShareBodySchema`, and the one on the user row is
   * lower-cased at sign-in. One un-normalized write would make the grant silently miss.
   */
  it('matches an address that differs only in case', async () => {
    const body = createShareBodySchema.parse({
      nodeId: LEGAL,
      mode: 'USER',
      granteeEmail: '  Grantee@Example.COM ',
    });
    world.shares = [share({ granteeEmail: body.granteeEmail })];

    const scope = await serviceFor(world).resolveForUser(GRANTEE, ROOM);

    expect(scope.rootNodeId).toBe(LEGAL);
  });

  it('picks the broader of two live grants, and picks it every time', async () => {
    world.shares = [
      share({ nodeId: NDA, createdAt: new Date('2026-02-01T00:00:00.000Z') }),
      share({ nodeId: LEGAL, createdAt: new Date('2026-03-01T00:00:00.000Z') }),
    ];
    const service = serviceFor(world);

    const first = await service.resolveForUser(GRANTEE, ROOM);
    const second = await service.resolveForUser(GRANTEE, ROOM);

    expect(first.rootNodeId).toBe(LEGAL);
    expect(second).toEqual(first);
  });

  it('lets a whole-room grant win over a deeper one, whatever the order they were made in', async () => {
    world.shares = [
      share({ nodeId: NDA, createdAt: new Date('2026-01-01T00:00:00.000Z') }),
      share({ nodeId: null, createdAt: new Date('2026-06-01T00:00:00.000Z') }),
    ];

    const scope = await serviceFor(world).resolveForUser(GRANTEE, ROOM);

    expect(scope.rootNodeId).toBeNull();
    expect(scope.rootPath).toBe('/');
    expect(scope.role).toBe('VIEWER');
  });

  it('treats a revoked grant as no grant at all', async () => {
    world.shares = [share({ revokedAt: new Date('2026-05-01T00:00:00.000Z') })];

    await expect(serviceFor(world).resolveForUser(GRANTEE, ROOM)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('treats an expired grant as no grant at all', async () => {
    world.shares = [share({ expiresAt: new Date('2026-05-01T00:00:00.000Z') })];

    await expect(serviceFor(world).resolveForUser(GRANTEE, ROOM)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  /**
   * **A `404` here would be the wrong behaviour**, and a test asserting one would pin it.
   * The grant is real and the grantee is entitled to know that what they were given has
   * been deleted — a `410` and the "deleted by the owner" screen. That `410` is raised on
   * the node, in `NodeService`, which can only happen if a scope was produced first.
   */
  it('still produces a scope when the granted node has been deleted', async () => {
    world.shares = [share({ nodeId: LEGAL })];
    world.deletedNodes.add(LEGAL);

    const scope = await serviceFor(world).resolveForUser(GRANTEE, ROOM);

    expect(scope.rootNodeId).toBe(LEGAL);
  });

  it('inherits access downwards and stops at the boundary', async () => {
    world.shares = [share({ nodeId: LEGAL })];

    const scope = await serviceFor(world).resolveForUser(GRANTEE, ROOM);

    expect(pathOf(NDA).startsWith(scope.rootPath)).toBe(true);
    expect(pathOf(FINANCE).startsWith(scope.rootPath)).toBe(false);
  });

  describe('resolveForToken', () => {
    const token = 'a-token';

    it('resolves a live LINK share to its subtree', async () => {
      world.shares = [
        share({ mode: 'LINK', granteeEmail: null, tokenHash: hashShareToken(token) }),
      ];

      const scope = await serviceFor(world).resolveForToken(token);

      expect(scope.rootNodeId).toBe(LEGAL);
      expect(scope.role).toBe('VIEWER');
    });

    /**
     * One answer for three states, on purpose. A `404` for "this token never existed"
     * would separate real links from invented ones, and tells the person holding a broken
     * link nothing they can use.
     */
    it.each([
      ['unknown', share({ mode: 'LINK', granteeEmail: null, tokenHash: 'other' })],
      [
        'revoked',
        share({
          mode: 'LINK',
          granteeEmail: null,
          tokenHash: hashShareToken(token),
          revokedAt: new Date('2026-05-01T00:00:00.000Z'),
        }),
      ],
      [
        'expired',
        share({
          mode: 'LINK',
          granteeEmail: null,
          tokenHash: hashShareToken(token),
          expiresAt: new Date('2026-05-01T00:00:00.000Z'),
        }),
      ],
    ])('answers 410 for a %s token', async (_state, row) => {
      world.shares = [row];

      await expect(serviceFor(world).resolveForToken(token)).rejects.toBeInstanceOf(GoneException);
    });
  });
});

/**
 * Two `NodeService` behaviours that only exist for a subtree scope, and therefore can only
 * be exercised with one a `VIEWER` grant produced. Both are about what a grantee is *not*
 * told: the names above their root, and an empty folder where a deletion happened.
 */
describe('NodeService under a VIEWER scope', () => {
  const deep = randomUUID();
  const deepPath = `${pathOf(NDA)}${deep}/`;
  const deeper = randomUUID();
  const deeperPath = `${deepPath}${deeper}/`;

  function nodeRecord(id: string, path: string, deletedAt: Date | null = null): NodeRecord {
    return {
      id,
      parentId: null,
      type: 'FOLDER',
      name: 'Folder',
      path,
      size: 0,
      totalSize: 0,
      fileCount: 0,
      folderCount: 0,
      blobId: null,
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      deletedAt,
    };
  }

  function nodeServiceFor(rows: Record<string, NodeRecord>, requested: string[][]) {
    const nodes = {
      findInScope: (scope: { rootPath: string }, id: string) => {
        const row = rows[id];
        return Promise.resolve(row && row.path.startsWith(scope.rootPath) ? row : null);
      },
      findAncestorsInScope: (_scope: unknown, ids: readonly string[]) => {
        requested.push([...ids]);
        return Promise.resolve(ids.map((id) => ({ id, name: 'Folder' })));
      },
      listChildrenInScope: () => Promise.resolve([]),
    } as unknown as NodeRepository;

    return new NodeService(nodes, {
      findInScope: () => Promise.resolve(null),
    } as unknown as DataRoomRepository);
  }

  async function viewerScope(deletedNodes: string[] = []) {
    const world: World = {
      user: {
        id: GRANTEE,
        email: GRANTEE_EMAIL,
        emailVerified: true,
        name: null,
        avatarUrl: null,
      },
      shares: [share({ nodeId: NDA })],
      deletedNodes: new Set(deletedNodes),
    };
    return serviceFor(world).resolveForUser(GRANTEE, ROOM);
  }

  /**
   * Breadcrumbs are clipped by arithmetic, not by a filter: the ids come from the part of
   * `path` below the scope root, so `/legal/` is never even asked for. In an M&A context a
   * folder name is itself confidential, and a request that is never made cannot leak one.
   */
  it('never asks for an ancestor above the scope root', async () => {
    const requested: string[][] = [];
    const service = nodeServiceFor(
      {
        [NDA]: nodeRecord(NDA, pathOf(NDA)),
        [deep]: nodeRecord(deep, deepPath),
        [deeper]: nodeRecord(deeper, deeperPath),
      },
      requested,
    );

    const response = await service.browse(await viewerScope(), deeper);

    // The trail runs from below the scope root: `deep`, and neither the root itself nor
    // `/legal/` above it.
    expect(requested.flat()).toEqual([deep]);
    expect(requested.flat()).not.toContain(LEGAL);
    expect(requested.flat()).not.toContain(NDA);
    expect(response.role).toBe('VIEWER');
    // The room's name and totals sit above a subtree scope and never travel with it.
    expect(response.room).toBeUndefined();
  });

  /**
   * Without the scope-root liveness check this is an empty listing and a "Nothing here
   * yet" screen — a silent falsehood about somebody else's documents.
   */
  it('answers 410 at the scope root when the granted folder has been deleted', async () => {
    const service = nodeServiceFor(
      { [NDA]: nodeRecord(NDA, pathOf(NDA), new Date('2026-05-01T00:00:00.000Z')) },
      [],
    );

    await expect(service.browse(await viewerScope([NDA]))).rejects.toBeInstanceOf(GoneException);
  });
});
