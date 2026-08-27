import { GoneException, NotFoundException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { AccessControlService } from '../../access/access-control.service';
import type { AccessScope } from '../../access/access-scope';
import type { Env } from '../../config/env';
import type { PrismaService } from '../../persistence/prisma.service';
import { createTestPrisma } from '../../test-support/database';
import { FixturesRepository } from '../../test-support/fixtures.repository';
import { UserRepository } from '../auth/user.repository';
import { DataRoomRepository } from '../data-room/data-room.repository';
import { NodeRepository } from '../node/node.repository';
import { NodeService } from '../node/node.service';
import { ShareRepository } from './share.repository';
import { ShareService } from './share.service';

/**
 * Sharing against a real Postgres, because the two properties that matter here are ones a
 * mocked repository cannot show:
 *
 * - `findGrantNodeInRoom` is raw SQL, and raw SQL bypasses the soft-delete extension. That
 *   bypass is the whole reason a grantee whose folder was deleted gets a `410` rather than
 *   an empty listing, and a mock would "pass" whatever the statement actually said.
 * - `shares_mode_check` lives in the database. A row the schemas would have refused is
 *   refused again here, one layer down.
 */
describe('sharing against Postgres', () => {
  let prisma: PrismaService;
  let fixtures: FixturesRepository;
  let users: UserRepository;
  let dataRooms: DataRoomRepository;
  let nodeRepository: NodeRepository;
  let nodes: NodeService;
  let shareRepository: ShareRepository;
  let shares: ShareService;
  let accessControl: AccessControlService;

  beforeAll(async () => {
    prisma = await createTestPrisma();
    fixtures = new FixturesRepository(prisma);
    users = new UserRepository(prisma);
    dataRooms = new DataRoomRepository(prisma);
    nodeRepository = new NodeRepository(prisma);
    shareRepository = new ShareRepository(prisma);
    nodes = new NodeService(nodeRepository, dataRooms);
    accessControl = new AccessControlService(dataRooms, shareRepository, nodeRepository, users);
    shares = new ShareService(shareRepository, nodes, nodeRepository, users, {
      get: () => 'https://dataroom.example',
    } as unknown as ConfigService<Env, true>);
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  beforeEach(async () => {
    await fixtures.reset();
  });

  /**
   * An owner with `/Legal/NDA/`, and a second signed-in account holding nothing yet.
   *
   * Scopes are resolved through `AccessControlService` rather than assembled, because
   * `AccessScope` is branded and cannot be assembled: a test takes the path a request does.
   */
  async function setUp() {
    const owner = await users.upsertFromGoogle({
      providerAccountId: 'google-owner',
      email: 'owner@example.com',
      emailVerified: true,
      name: 'Owner',
      avatarUrl: null,
    });
    const grantee = await users.upsertFromGoogle({
      providerAccountId: 'google-grantee',
      email: 'grantee@example.com',
      emailVerified: true,
      name: 'Grantee',
      avatarUrl: null,
    });

    const room = await dataRooms.create(owner.id, 'Project Falcon');
    const ownerScope = await accessControl.resolveForUser(owner.id, room.id);

    const legal = await nodes.createFolder(ownerScope, { parentId: null, name: 'Legal' }, owner.id);
    const nda = await nodes.createFolder(ownerScope, { parentId: legal.id, name: 'NDA' }, owner.id);
    const finance = await nodes.createFolder(
      ownerScope,
      { parentId: null, name: 'Finance' },
      owner.id,
    );

    return { owner, grantee, room, ownerScope, legal, nda, finance };
  }

  async function grant(
    scope: AccessScope,
    ownerId: string,
    nodeId: string | null,
    granteeEmail = 'grantee@example.com',
  ) {
    return shares.create(scope, { nodeId, mode: 'USER', granteeEmail }, ownerId);
  }

  it('lets a grantee browse the granted subtree and nothing beside it', async () => {
    const { owner, grantee, room, ownerScope, legal, nda, finance } = await setUp();
    await grant(ownerScope, owner.id, legal.id);

    const granteeScope = await accessControl.resolveForUser(grantee.id, room.id);
    const atRoot = await nodes.browse(granteeScope);

    expect(granteeScope.role).toBe('VIEWER');
    expect(atRoot.node).toBeNull();
    expect(atRoot.children.map((child) => child.name)).toEqual(['NDA']);
    // The room's name and totals sit above the scope root and never travel with it.
    expect(atRoot.room).toBeUndefined();

    // Inside the boundary, and nowhere else. `Finance` is a sibling of the share root: a
    // caller guessing its id must not be able to tell it from a node that never existed.
    await expect(nodes.browse(granteeScope, nda.id)).resolves.toMatchObject({
      node: { name: 'NDA' },
    });
    await expect(nodes.browse(granteeScope, finance.id)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('clips the grantee’s breadcrumbs to the share root', async () => {
    const { owner, grantee, room, ownerScope, legal, nda } = await setUp();
    const deep = await nodes.createFolder(ownerScope, { parentId: nda.id, name: 'Deep' }, owner.id);
    await grant(ownerScope, owner.id, legal.id);

    const granteeScope = await accessControl.resolveForUser(grantee.id, room.id);
    const response = await nodes.browse(granteeScope, deep.id);

    // `NDA` only: the trail starts below the share root, and `Legal` above it is never
    // named. In an M&A context a folder name is itself confidential.
    expect(response.breadcrumbs.map((crumb) => crumb.name)).toEqual(['NDA']);
  });

  /**
   * The soft-delete bypass, end to end. Every child of a deleted folder is stamped too, so
   * without the scope-root liveness check this is an empty listing and a "Nothing here
   * yet" screen — a silent falsehood about somebody else's documents.
   */
  it('answers 410, not 404 and not an empty folder, once the owner deletes the granted node', async () => {
    const { owner, grantee, room, ownerScope, legal } = await setUp();
    await grant(ownerScope, owner.id, legal.id);

    await nodes.deleteSubtree(ownerScope, legal.id);

    const granteeScope = await accessControl.resolveForUser(grantee.id, room.id);
    await expect(nodes.browse(granteeScope)).rejects.toBeInstanceOf(GoneException);
  });

  it('resolves the broadest of two live grants', async () => {
    const { owner, grantee, room, ownerScope, legal, nda } = await setUp();
    await grant(ownerScope, owner.id, nda.id);
    await grant(ownerScope, owner.id, legal.id);

    const granteeScope = await accessControl.resolveForUser(grantee.id, room.id);

    expect(granteeScope.rootNodeId).toBe(legal.id);
  });

  /**
   * The interaction the broadest-grant rule did not cover on its own: two grants on
   * **sibling** folders, the older of which the owner deletes.
   *
   * `path` is a sequence of fixed-width UUID segments, so two folders at the same depth
   * compare equal on length and the order falls through to `createdAt` — the older grant.
   * Before liveness became the first sort key that handed the grantee a dead scope root,
   * and with it a `410` at the room root and a `404` on the folder that was still live,
   * while "Shared with me" went on listing it.
   */
  it('does not let a deleted grant shadow a live one on a sibling folder', async () => {
    const { owner, grantee, room, ownerScope, legal, finance } = await setUp();
    await grant(ownerScope, owner.id, legal.id);
    await grant(ownerScope, owner.id, finance.id);

    await nodes.deleteSubtree(ownerScope, legal.id);

    const granteeScope = await accessControl.resolveForUser(grantee.id, room.id);

    expect(granteeScope.rootNodeId).toBe(finance.id);
    // And the survivor is genuinely reachable, not merely selected.
    await expect(nodes.browse(granteeScope)).resolves.toMatchObject({ role: 'VIEWER' });
  });

  /**
   * The other half of the same rule: sorting dead grants last must not become filtering
   * them out. With nothing live left, the grantee is still owed the `410` that says the
   * owner deleted it — not the `404` that reads as "you were never given this".
   */
  it('still answers 410 when every grant the grantee holds points at a deleted node', async () => {
    const { owner, grantee, room, ownerScope, legal, finance } = await setUp();
    await grant(ownerScope, owner.id, legal.id);
    await grant(ownerScope, owner.id, finance.id);

    await nodes.deleteSubtree(ownerScope, legal.id);
    await nodes.deleteSubtree(ownerScope, finance.id);

    const granteeScope = await accessControl.resolveForUser(grantee.id, room.id);
    await expect(nodes.browse(granteeScope)).rejects.toBeInstanceOf(GoneException);
  });

  it('stops resolving once the share is revoked', async () => {
    const { owner, grantee, room, ownerScope, legal } = await setUp();
    const share = await grant(ownerScope, owner.id, legal.id);

    await shares.revoke(ownerScope, share.id, false);

    await expect(accessControl.resolveForUser(grantee.id, room.id)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  /**
   * The token crosses the wire exactly once. `shareSummarySchema` has no field for it, so
   * the listing cannot leak it even by accident — this pins that the listing is the same
   * shape and that the hash, not the token, is what the lookup takes.
   */
  it('returns a LINK url once and never again, and the token resolves', async () => {
    const { owner, ownerScope, legal } = await setUp();

    const created = await shares.create(ownerScope, { nodeId: legal.id, mode: 'LINK' }, owner.id);
    const listed = await shares.listForNode(ownerScope, legal.id);

    const token = created.url?.split('/s/')[1] ?? '';

    expect(created.url).toMatch(/^https:\/\/dataroom\.example\/s\//);
    expect(token).not.toBe('');
    expect(listed).toHaveLength(1);
    expect(JSON.stringify(listed)).not.toContain(token);

    const scope = await accessControl.resolveForToken(token);
    expect(scope.rootNodeId).toBe(legal.id);

    await expect(accessControl.resolveForToken('not-a-token')).rejects.toBeInstanceOf(
      GoneException,
    );
  });

  it('gives a USER share no url at all', async () => {
    const { owner, ownerScope, legal } = await setUp();

    const created = await grant(ownerScope, owner.id, legal.id);

    expect(created.url).toBeNull();
    expect(created.mode).toBe('USER');
  });

  /**
   * A `VIEWER` is not an owner. Sharing is a mutation, and every mutation answers `404`
   * rather than `403` — two status codes for one boundary is how the one case that does
   * leak gets written later by analogy.
   */
  it('refuses to let a grantee re-share what was shared with them', async () => {
    const { owner, grantee, room, ownerScope, legal } = await setUp();
    await grant(ownerScope, owner.id, legal.id);
    const granteeScope = await accessControl.resolveForUser(grantee.id, room.id);

    await expect(
      shares.create(
        granteeScope,
        { nodeId: legal.id, mode: 'USER', granteeEmail: 'third@example.com' },
        grantee.id,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(shares.listForNode(granteeScope, legal.id)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('lists what was shared with a grantee by the granted node, never by the room', async () => {
    const { owner, grantee, ownerScope, legal } = await setUp();
    await grant(ownerScope, owner.id, legal.id);

    const listed = await shares.sharedWithMe(grantee.id);

    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({
      name: 'Legal',
      type: 'FOLDER',
      nodeId: legal.id,
      sharedBy: { email: 'owner@example.com' },
    });
    expect(JSON.stringify(listed)).not.toContain('Project Falcon');
  });

  it('names the room only when the grant is the room', async () => {
    const { owner, grantee, ownerScope } = await setUp();
    await grant(ownerScope, owner.id, null);

    const listed = await shares.sharedWithMe(grantee.id);

    expect(listed[0]).toMatchObject({ name: 'Project Falcon', type: 'ROOM', nodeId: null });
  });

  it('drops a grant whose node the owner has deleted from the listing', async () => {
    const { owner, grantee, ownerScope, legal } = await setUp();
    await grant(ownerScope, owner.id, legal.id);

    await nodes.deleteSubtree(ownerScope, legal.id);

    // Dropped from the menu, because every entry in it should lead somewhere — while a
    // direct request still gets the honest `410`, which the case above pins.
    expect(await shares.sharedWithMe(grantee.id)).toEqual([]);
  });

  /**
   * Decision #7's security requirement, one layer below the unit test that pins it: an
   * account registered on somebody else's address inherits nothing.
   */
  /**
   * Issue 09's whole reason to exist: a folder grant and a grant nested under it, for the
   * same grantee. Revoking the folder without `cascade` leaves the nested one working;
   * with it, both stop resolving.
   */
  describe('cascade revoke', () => {
    it('reports the nested grant in the list, and a plain revoke leaves it working', async () => {
      const { owner, grantee, room, ownerScope, legal, nda } = await setUp();
      await grant(ownerScope, owner.id, legal.id);
      await grant(ownerScope, owner.id, nda.id);

      const list = await shares.listForNode(ownerScope, legal.id);
      expect(list).toHaveLength(1);
      expect(list[0]?.nestedLiveGrantCount).toBe(1);

      await shares.revoke(ownerScope, list[0]?.id ?? '', false);

      const granteeScope = await accessControl.resolveForUser(grantee.id, room.id);
      expect(granteeScope.rootNodeId).toBe(nda.id);
    });

    it('cascades: revoking the folder grant also revokes the one nested under it', async () => {
      const { owner, grantee, room, ownerScope, legal, nda } = await setUp();
      const legalGrant = await grant(ownerScope, owner.id, legal.id);
      await grant(ownerScope, owner.id, nda.id);

      await shares.revoke(ownerScope, legalGrant.id, true);

      await expect(accessControl.resolveForUser(grantee.id, room.id)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('does not count a sibling folder whose name merely shares a prefix', async () => {
      const { owner, ownerScope, legal } = await setUp();
      const legalArchive = await nodes.createFolder(
        ownerScope,
        { parentId: null, name: 'Legal Archive' },
        owner.id,
      );
      await grant(ownerScope, owner.id, legal.id);
      await grant(ownerScope, owner.id, legalArchive.id);

      const list = await shares.listForNode(ownerScope, legal.id);
      expect(list[0]?.nestedLiveGrantCount).toBe(0);
    });

    it('does not count a grant on a folder the owner has already deleted', async () => {
      const { owner, ownerScope, legal, nda } = await setUp();
      await grant(ownerScope, owner.id, legal.id);
      await grant(ownerScope, owner.id, nda.id);
      await nodes.deleteSubtree(ownerScope, nda.id);

      const list = await shares.listForNode(ownerScope, legal.id);
      expect(list[0]?.nestedLiveGrantCount).toBe(0);
    });

    it('never cascades a LINK share', async () => {
      const { owner, ownerScope, legal, nda } = await setUp();
      const link = await shares.create(ownerScope, { nodeId: legal.id, mode: 'LINK' }, owner.id);
      await grant(ownerScope, owner.id, nda.id);

      await shares.revoke(ownerScope, link.id, true);

      // Still live: a LINK revoke never touches anything beneath it, cascade or not.
      expect(await shares.listForNode(ownerScope, nda.id)).toHaveLength(1);
    });
  });

  it('matches nothing for an unverified address', async () => {
    const { owner, room, ownerScope, legal } = await setUp();
    const unverified = await users.upsertFromGoogle({
      providerAccountId: 'google-unverified',
      email: 'unverified@example.com',
      emailVerified: false,
      name: null,
      avatarUrl: null,
    });
    await grant(ownerScope, owner.id, legal.id, 'unverified@example.com');

    await expect(accessControl.resolveForUser(unverified.id, room.id)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(await shares.sharedWithMe(unverified.id)).toEqual([]);
  });
});
