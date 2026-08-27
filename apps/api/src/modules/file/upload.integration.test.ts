import { GoneException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { ExecutionContext } from '@nestjs/common';
import { ThrottlerException, ThrottlerStorageService } from '@nestjs/throttler';
import { UPLOAD_MIME_TYPE } from '@dr/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { AccessControlService } from '../../access/access-control.service';
import type { AccessScope } from '../../access/access-scope';
import { SessionThrottlerGuard } from '../../common/session-throttler.guard';
import { PRESIGN_THROTTLER, throttlerConfig } from '../../common/throttler.config';
import type { PrismaService } from '../../persistence/prisma.service';
import { TransactionRunner } from '../../persistence/transaction.runner';
import { createTestPrisma } from '../../test-support/database';
import { FixturesRepository } from '../../test-support/fixtures.repository';
import { StorageDouble } from '../../test-support/storage.double';
import { UserRepository } from '../auth/user.repository';
import { DataRoomRepository } from '../data-room/data-room.repository';
import { NodeRepository } from '../node/node.repository';
import { NodeService } from '../node/node.service';
import { ShareRepository } from '../share/share.repository';
import { BlobRepository } from './blob.repository';
import { UploadService } from './upload.service';

/**
 * The upload protocol against a real Postgres (decision #26).
 *
 * What is under test is transaction state, not S3: the conditional `PENDING → READY` flip,
 * the advisory lock, the aggregate delta and the `23505` retry. A mocked repository never
 * enters a transaction, so none of it would execute.
 */
describe('upload protocol against Postgres', () => {
  let prisma: PrismaService;
  let fixtures: FixturesRepository;
  let storage: StorageDouble;
  let uploads: UploadService;
  let users: UserRepository;
  let dataRooms: DataRoomRepository;
  let accessControl: AccessControlService;

  beforeAll(async () => {
    prisma = await createTestPrisma();
    fixtures = new FixturesRepository(prisma);
    storage = new StorageDouble();

    const nodeRepository = new NodeRepository(prisma);
    const blobs = new BlobRepository(prisma);
    dataRooms = new DataRoomRepository(prisma);
    users = new UserRepository(prisma);
    accessControl = new AccessControlService(
      dataRooms,
      new ShareRepository(prisma),
      nodeRepository,
      users,
    );

    uploads = new UploadService(
      blobs,
      nodeRepository,
      new NodeService(nodeRepository, dataRooms),
      dataRooms,
      storage.asService(),
      new TransactionRunner(prisma),
    );
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  beforeEach(async () => {
    await fixtures.reset();
    storage.objects.clear();
    storage.deleted.length = 0;
  });

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

  /** The whole protocol for one file: presign, the browser's PUT, complete. */
  async function upload(scope: AccessScope, userId: string, file: { name: string; size: number }) {
    const { files } = await uploads.presign(scope, {
      parentId: null,
      files: [{ name: file.name, size: file.size, mimeType: UPLOAD_MIME_TYPE }],
    });

    const presigned = files[0];
    if (!presigned) throw new Error('presign returned no file');

    storage.put(`${scope.dataRoomId}/${presigned.blobId}`, {
      size: file.size,
      contentType: UPLOAD_MIME_TYPE,
    });

    const result = await uploads.complete(
      scope,
      { blobId: presigned.blobId, parentId: null, name: file.name },
      userId,
    );
    return { blobId: presigned.blobId, ...result };
  }

  /**
   * The `23505` retry, and the assertion that has teeth.
   *
   * "The second file is named `contract (1).pdf`" passes whether the retry re-runs the
   * whole transaction or only the insert, so it proves nothing on its own. What separates
   * the two is the **blob**: the flip happens before the insert, so a `23505` rolls it back
   * with everything else and the blob returns to `PENDING` for the retry to flip again.
   *
   * Had the flip sat outside the transaction — or had only the insert been retried — the
   * second attempt would have found the blob already `READY`, taken the idempotent branch,
   * looked for a node by `blobId`, found none, and answered **`410`**. A `410` here is the
   * failure this test exists to catch.
   */
  it('re-runs the whole transaction on a name collision and charges the room once', async () => {
    const { scope, userId, dataRoomId } = await signInAsOwner();

    const first = await upload(scope, userId, { name: 'contract.pdf', size: 1_000 });
    const second = await upload(scope, userId, { name: 'contract.pdf', size: 2_000 });

    expect(first.node.name).toBe('contract.pdf');
    expect(second.node.name).toBe('contract (1).pdf');
    expect(second.created).toBe(true);

    // The retried blob ended READY exactly once, carrying the size storage reported rather
    // than the one the client claimed.
    expect(await fixtures.blob(second.blobId)).toEqual({ status: 'READY', size: 2_000 });
    expect(await fixtures.nodeCountForBlob(second.blobId)).toBe(1);

    // Charged once, not once per attempt.
    expect(await fixtures.roomCounters(dataRoomId)).toEqual({
      totalSize: 3_000,
      fileCount: 2,
      folderCount: 0,
    });
  });

  /**
   * Complete is idempotent through a **conditional** update, not a read-then-write.
   *
   * A lost response over a committed transaction is the ordinary case: the client retries,
   * and without the conditional flip the retry produces a second node on one blob and
   * charges the aggregates twice for bytes that exist once (decision #28).
   */
  it('answers a repeated complete with the same node and charges nothing again', async () => {
    const { scope, userId, dataRoomId } = await signInAsOwner();

    const { blobId, node } = await upload(scope, userId, { name: 'report.pdf', size: 4_096 });

    const replay = await uploads.complete(
      scope,
      { blobId, parentId: null, name: 'report.pdf' },
      userId,
    );

    expect(replay.created).toBe(false);
    expect(replay.node.id).toBe(node.id);
    expect(await fixtures.nodeCountForBlob(blobId)).toBe(1);
    expect(await fixtures.roomCounters(dataRoomId)).toEqual({
      totalSize: 4_096,
      fileCount: 1,
      folderCount: 0,
    });
  });

  /**
   * The other side of idempotency: a `READY` blob whose node is gone.
   *
   * A `READY` blob proves complete committed once, and complete commits the flip and the
   * insert together — so a missing live node means the file was deleted afterwards. `410`,
   * and the node is **not** re-created.
   */
  it('answers 410 when the completed file was deleted afterwards', async () => {
    const { scope, userId } = await signInAsOwner();
    const nodeRepository = new NodeRepository(prisma);
    const nodes = new NodeService(nodeRepository, dataRooms);

    const { blobId, node } = await upload(scope, userId, { name: 'minutes.pdf', size: 512 });
    await nodes.deleteSubtree(scope, node.id);

    await expect(
      uploads.complete(scope, { blobId, parentId: null, name: 'minutes.pdf' }, userId),
    ).rejects.toBeInstanceOf(GoneException);
  });
});

/**
 * The presign rate limit is **per user, not per IP**, and in a single-user test an IP
 * fallback looks identical — which is why this test uses two.
 *
 * Behind the Vercel rewrite `req.ip` is the proxy's address for every caller, so a
 * `|| req.ip` fallback would turn a broken guard chain into one shared bucket for the whole
 * deployment: a limit that works, counts, and is wrong. The guard throws instead.
 *
 * The guard is driven directly rather than through HTTP. `onModuleInit` is what populates
 * its throttler list from the module options, so it has to be awaited by hand here — the
 * DI container would otherwise do it.
 */
describe('presign rate limit', () => {
  // By name, not by position: the array carries every named bucket in the application now
  // (`throttler.config.ts` says why it has to), and the presign one is not privileged by
  // being written first.
  const buckets = throttlerConfig as Array<{ name?: string; limit: number }>;
  const limit = buckets.find((bucket) => bucket.name === PRESIGN_THROTTLER)?.limit ?? 0;

  function contextFor(userId: string): ExecutionContext {
    const request = { user: { userId, email: `${userId}@example.com`, issuedAt: null } };
    const response = { header: () => undefined, setHeader: () => undefined };
    return {
      switchToHttp: () => ({ getRequest: () => request, getResponse: () => response }),
      getHandler: () => function presignHandler() {},
      getClass: () => class UploadControllerDouble {},
    } as unknown as ExecutionContext;
  }

  async function guardUnderTest(): Promise<SessionThrottlerGuard> {
    const guard = new SessionThrottlerGuard(
      throttlerConfig,
      new ThrottlerStorageService(),
      new Reflector(),
    );
    await guard.onModuleInit();
    return guard;
  }

  it('exhausts one user without touching the other', async () => {
    const guard = await guardUnderTest();

    for (let call = 0; call < limit; call += 1) {
      expect(await guard.canActivate(contextFor('user-a'))).toBe(true);
    }
    await expect(guard.canActivate(contextFor('user-a'))).rejects.toBeInstanceOf(
      ThrottlerException,
    );

    // The second user has its own bucket. Under an IP fallback both would share one and
    // this call would be refused too.
    expect(await guard.canActivate(contextFor('user-b'))).toBe(true);
  });

  /**
   * A missing session is a broken guard chain — the throttler registered globally, or
   * before `JwtAuthGuard` — and it must be loud rather than degrading into a shared bucket.
   */
  it('throws rather than falling back when there is no session', async () => {
    const guard = await guardUnderTest();
    const anonymous = {
      switchToHttp: () => ({
        getRequest: () => ({}),
        getResponse: () => ({ header: () => undefined }),
      }),
      getHandler: () => function presignHandler() {},
      getClass: () => class UploadControllerDouble {},
    } as unknown as ExecutionContext;

    await expect(guard.canActivate(anonymous)).rejects.toThrow(/JwtAuthGuard/);
  });
});
