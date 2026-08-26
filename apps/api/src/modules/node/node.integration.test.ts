import { randomUUID } from 'node:crypto';

import {
  ConflictException,
  GoneException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { NodeType } from '@dr/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { AccessControlService } from '../../access/access-control.service';
import type { AccessScope } from '../../access/access-scope';
import type { PrismaService } from '../../persistence/prisma.service';
import { TransactionRunner } from '../../persistence/transaction.runner';
import { createTestPrisma } from '../../test-support/database';
import { FixturesRepository } from '../../test-support/fixtures.repository';
import { UserRepository } from '../auth/user.repository';
import { DataRoomRepository } from '../data-room/data-room.repository';
import { BlobRepository } from '../file/blob.repository';
import { ShareRepository } from '../share/share.repository';
import { NodeRepository } from './node.repository';
import { NodeService } from './node.service';

/**
 * These run against a real Postgres, and they have to (decision #26). What they cover is
 * raw SQL: a mocked repository never executes a statement, never bypasses the soft-delete
 * extension, and never enters a transaction — which is exactly where this phase's design
 * is load-bearing.
 *
 * Both failures below are **silent**. Neither throws; each produces a wrong number or an
 * invented name, and the first place a person would notice is the delete-warning dialog,
 * which `BRIEF.md` grades.
 */
describe('node repository against Postgres', () => {
  let prisma: PrismaService;
  let fixtures: FixturesRepository;
  let nodeRepository: NodeRepository;
  let nodes: NodeService;
  let users: UserRepository;
  let dataRooms: DataRoomRepository;
  let accessControl: AccessControlService;
  let blobs: BlobRepository;
  let transactions: TransactionRunner;

  beforeAll(async () => {
    prisma = await createTestPrisma();
    fixtures = new FixturesRepository(prisma);
    nodeRepository = new NodeRepository(prisma);
    dataRooms = new DataRoomRepository(prisma);
    users = new UserRepository(prisma);
    blobs = new BlobRepository(prisma);
    transactions = new TransactionRunner(prisma);
    nodes = new NodeService(nodeRepository, dataRooms);
    accessControl = new AccessControlService(
      dataRooms,
      new ShareRepository(prisma),
      nodeRepository,
      users,
    );
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  beforeEach(async () => {
    await fixtures.reset();
  });

  /**
   * A signed-in owner and their room.
   *
   * The scope is resolved through `AccessControlService` rather than assembled here,
   * because it cannot be assembled here: `AccessScope` is branded, and the brand is not
   * exported. A test takes the same path a request does.
   */
  async function signInAsOwner(): Promise<{
    scope: AccessScope;
    userId: string;
    dataRoomId: string;
  }> {
    const user = await users.upsertFromGoogle({
      providerAccountId: 'google-owner',
      email: 'owner@example.com',
      emailVerified: true,
      name: 'Owner',
      avatarUrl: null,
    });
    const room = await dataRooms.create(user.id, 'Test Data Room');
    const scope = await accessControl.resolveForUser(user.id, room.id);
    return { scope, userId: user.id, dataRoomId: room.id };
  }

  /**
   * A `FILE` node, created the only way one can be: through the repository inside a
   * transaction, pointing at a blob.
   *
   * The upload protocol is exercised in `upload.integration.test.ts`; here a file is just
   * the input the listing and the move need, so the storage round trip is skipped and the
   * blob is inserted directly.
   */
  async function createFile(
    scope: AccessScope,
    userId: string,
    name: string,
    size: number,
    parentId: string | null = null,
  ) {
    const blob = await blobs.createPending(scope.dataRoomId, {
      mimeType: 'application/pdf',
      size,
    });
    const destination = await nodes.resolveParentLocation(scope, parentId);

    return transactions.run(async (tx) => {
      await blobs.markReadyIfPending(tx, scope.dataRoomId, blob.id, {
        size,
        mimeType: 'application/pdf',
      });
      return nodeRepository.createFile(tx, scope, {
        ...destination,
        name,
        blobId: blob.id,
        size,
        createdById: userId,
      });
    });
  }

  it('counts each row once when the subtree already contains a deleted node', async () => {
    const { scope, userId, dataRoomId } = await signInAsOwner();

    //  A ── B ── D
    //   └── C
    const a = await nodes.createFolder(scope, { parentId: null, name: 'A' }, userId);
    const b = await nodes.createFolder(scope, { parentId: a.id, name: 'B' }, userId);
    await nodes.createFolder(scope, { parentId: a.id, name: 'C' }, userId);
    await nodes.createFolder(scope, { parentId: b.id, name: 'D' }, userId);

    expect(await fixtures.roomCounters(dataRoomId)).toMatchObject({ folderCount: 4 });
    expect(await fixtures.nodeCounters(a.id)).toMatchObject({ folderCount: 3 });

    // First delete: B and D go, and A keeps only C.
    await nodes.deleteSubtree(scope, b.id);
    expect(await fixtures.nodeCounters(a.id)).toMatchObject({ folderCount: 1 });
    expect(await fixtures.roomCounters(dataRoomId)).toMatchObject({ folderCount: 2 });

    // Someone standing inside B while it was deleted gets `410`, not `404`: they were
    // entitled to see it alive, and the two states render different screens. A node that
    // never existed stays `404`, and so does one outside the scope — the statement cannot
    // tell those apart, which is the point.
    await expect(nodes.browse(scope, b.id)).rejects.toBeInstanceOf(GoneException);
    await expect(nodes.browse(scope, randomUUID())).rejects.toBeInstanceOf(NotFoundException);

    // Second delete, over a subtree that now contains two already-deleted rows. The
    // statement must stamp — and return — only A and C.
    const live = await nodes.resolveLiveNode(scope, a.id);
    const delta = await nodeRepository.deleteSubtree(scope, live);

    // Without `AND deleted_at IS NULL` this is -4: B and D are re-stamped and charged to
    // the room a second time. Nothing throws; the room simply reports folders it does
    // not have, and the number the delete warning shows is wrong.
    expect(delta.folders).toBe(-2);
    expect(await fixtures.roomCounters(dataRoomId)).toMatchObject({
      folderCount: 0,
      fileCount: 0,
      totalSize: 0,
    });
  });

  it('refuses a rename onto a taken name with 409, and invents no suffix', async () => {
    const { scope, userId } = await signInAsOwner();

    await nodes.createFolder(scope, { parentId: null, name: 'Legal' }, userId);
    const contracts = await nodes.createFolder(
      scope,
      { parentId: null, name: 'Contracts' },
      userId,
    );

    // Uniqueness is on lower(name), so the collision is case-insensitive.
    await expect(nodes.rename(scope, contracts.id, 'legal')).rejects.toBeInstanceOf(
      ConflictException,
    );

    // The user typed this name, so a refusal is the whole answer (decision #20). A
    // `Legal (1)` here would be the upload behaviour applied where nobody asked for it.
    expect(await fixtures.nodeName(contracts.id)).toBe('Contracts');
    const { children } = await nodes.browse(scope);
    expect(children.map((child) => child.name)).toEqual(['Contracts', 'Legal']);
  });

  /**
   * The listing is the other statement Prisma cannot express, and its two halves have to
   * agree: `ORDER BY type, lower(name)` and a row-wise keyset comparison on the same
   * pair. When they disagree a row is dropped or served twice at a page boundary —
   * invisible until a folder grows past one page.
   *
   * Driven at the repository with a page size of two rather than through the service,
   * which fixes it at fifty: the statement is what is under test, not the constant.
   */
  it('pages children by (type, lower(name)) without dropping or repeating a row', async () => {
    const { scope, userId, dataRoomId } = await signInAsOwner();

    // Mixed case on purpose: the sort key is lower(name), so 'charlie' sorts after
    // 'Beta' and before 'delta' — an ordering a plain `ORDER BY name` gets wrong.
    for (const name of ['delta', 'Alpha', 'echo', 'Beta', 'charlie']) {
      await nodes.createFolder(scope, { parentId: null, name }, userId);
    }

    const seen: string[] = [];
    // Root-level children are addressed by the room's id — the same COALESCE key the
    // listing index and the uniqueness index are built on.
    let after: { type: NodeType; lowerName: string } | null = null;
    for (let page = 0; page < 10; page += 1) {
      const rows = await nodeRepository.listChildrenInScope(scope, dataRoomId, after, 2);
      if (rows.length === 0) break;
      seen.push(...rows.map((row) => row.name));
      const last = rows[rows.length - 1];
      after = last ? { type: last.type, lowerName: last.lowerName } : null;
    }

    expect(seen).toEqual(['Alpha', 'Beta', 'charlie', 'delta', 'echo']);
  });

  /**
   * The same statement over **mixed data**, which it has never run against.
   *
   * Folders-before-files rests on two things: `CREATE TYPE "NodeType" AS ENUM ('FOLDER',
   * 'FILE')` fixing the enum's sort order, and the keyset comparing `::"NodeType"` rather
   * than text — as text, `'FILE' < 'FOLDER'` and the order inverts. Both are right by
   * inspection; this is what executes them.
   *
   * The page size is two, so a boundary falls **between** the last folder and the first
   * file, which is exactly where a text comparison would drop or repeat a row.
   */
  it('lists folders before files across a page boundary', async () => {
    const { scope, userId, dataRoomId } = await signInAsOwner();

    await nodes.createFolder(scope, { parentId: null, name: 'Beta' }, userId);
    await nodes.createFolder(scope, { parentId: null, name: 'alpha' }, userId);
    await createFile(scope, userId, 'Contract.pdf', 1_024);
    await createFile(scope, userId, 'annex.pdf', 2_048);

    const seen: { name: string; type: NodeType }[] = [];
    let after: { type: NodeType; lowerName: string } | null = null;
    for (let page = 0; page < 10; page += 1) {
      const rows = await nodeRepository.listChildrenInScope(scope, dataRoomId, after, 2);
      if (rows.length === 0) break;
      seen.push(...rows.map((row) => ({ name: row.name, type: row.type })));
      const last = rows[rows.length - 1];
      after = last ? { type: last.type, lowerName: last.lowerName } : null;
    }

    expect(seen).toEqual([
      { name: 'alpha', type: 'FOLDER' },
      { name: 'Beta', type: 'FOLDER' },
      { name: 'annex.pdf', type: 'FILE' },
      { name: 'Contract.pdf', type: 'FILE' },
    ]);
  });

  /**
   * The cycle guard, exercised against the shared move path rather than through a screen.
   *
   * `BRIEF.md` only requires moving a *file* and no phase builds a folder-move UI, so this
   * test is the only thing that runs the guard — and the guard is type-agnostic because the
   * method is shared.
   *
   * **`422`, not `409`.** A conflict is a name the user can change; a cycle is a request
   * that cannot be satisfied at all, and the dialog says so differently. The check is
   * `newParent.path.startsWith(node.path)` — no query — which also catches moving a node
   * into itself, because a node's own path starts with itself.
   */
  it('refuses to move a folder into its own descendant, and into itself', async () => {
    const { scope, userId } = await signInAsOwner();

    //  A ── B ── C
    const a = await nodes.createFolder(scope, { parentId: null, name: 'A' }, userId);
    const b = await nodes.createFolder(scope, { parentId: a.id, name: 'B' }, userId);
    const c = await nodes.createFolder(scope, { parentId: b.id, name: 'C' }, userId);

    await expect(nodes.move(scope, a.id, { parentId: c.id })).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
    await expect(nodes.move(scope, a.id, { parentId: a.id })).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );

    // Nothing moved, and no aggregate was transferred by the refusal.
    expect(await fixtures.nodeCounters(a.id)).toMatchObject({ folderCount: 2 });
  });

  /**
   * The successful move: the descendant `path` rewrite and **both halves** of the aggregate
   * transfer, in one transaction.
   *
   * The delta is the whole subtree read off the moved row's own counters plus itself, which
   * is what keeps this one statement per ancestor chain rather than a subtree scan. The two
   * Data Room updates net to zero — a move relocates a subtree inside one room.
   */
  it('moves a subtree, rewrites descendant paths and transfers the aggregates', async () => {
    const { scope, userId, dataRoomId } = await signInAsOwner();

    const source = await nodes.createFolder(scope, { parentId: null, name: 'Source' }, userId);
    const target = await nodes.createFolder(scope, { parentId: null, name: 'Target' }, userId);
    const moving = await nodes.createFolder(scope, { parentId: source.id, name: 'Deals' }, userId);
    await createFile(scope, userId, 'terms.pdf', 3_000, moving.id);

    expect(await fixtures.nodeCounters(source.id)).toMatchObject({
      totalSize: 3_000,
      fileCount: 1,
      folderCount: 1,
    });

    const moved = await nodes.move(scope, moving.id, { parentId: target.id });
    expect(moved.parentId).toBe(target.id);

    expect(await fixtures.nodeCounters(source.id)).toMatchObject({
      totalSize: 0,
      fileCount: 0,
      folderCount: 0,
    });
    expect(await fixtures.nodeCounters(target.id)).toMatchObject({
      totalSize: 3_000,
      fileCount: 1,
      folderCount: 1,
    });

    // The room is unchanged: a move relocates a subtree inside one room.
    expect(await fixtures.roomCounters(dataRoomId)).toEqual({
      totalSize: 3_000,
      fileCount: 1,
      folderCount: 3,
    });

    // The descendant's path was rewritten, so it is still reachable by browsing into the
    // moved folder rather than only by direct id.
    const { children } = await nodes.browse(scope, moving.id);
    expect(children.map((child) => child.name)).toEqual(['terms.pdf']);
  });
});
