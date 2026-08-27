import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';

import { AccessControlService } from '../../access/access-control.service';
import type { PrismaService } from '../../persistence/prisma.service';
import { createTestPrisma } from '../../test-support/database';
import { FixturesRepository } from '../../test-support/fixtures.repository';
import { UserRepository, type UserRecord } from '../auth/user.repository';
import { DataRoomRepository } from '../data-room/data-room.repository';
import { NodeRepository } from '../node/node.repository';
import { NodeService } from '../node/node.service';
import { ShareRepository } from '../share/share.repository';
import { DemoGrantService } from './demo-grant.service';
import {
  DEMO_OWNER_EMAIL,
  DEMO_OWNER_NAME,
  DEMO_PROVIDER_ACCOUNT_ID,
  DEMO_ROOM_ID,
  DEMO_ROOM_NAME,
  DEMO_SHARE_FOLDER_ID,
  DEMO_SHARE_FOLDER_NAME,
} from './demo.constants';

/**
 * The first-login demo grant, against a real Postgres.
 *
 * It is here rather than in a mocked unit test because the two things worth checking are
 * ones a mock would happily agree with: that the grant a sign-in writes actually **resolves
 * to a clipped scope** on the way back in, and that `Internal` — the folder deliberately
 * seeded outside the shared one — is invisible from inside it. Both go through raw SQL and
 * the branded `AccessScope`, so the only honest check is the round trip.
 *
 * The demo tree is built here by hand rather than by running `seed.ts`: the seed needs
 * object storage for its PDFs, and what this file is about is the grant, not the bytes.
 * What it does reproduce exactly are the two **fixed ids**, because addressing the folder
 * by id instead of by name is the property that keeps the seed and the grant in step.
 */
describe('the first-login demo grant', () => {
  let prisma: PrismaService;
  let fixtures: FixturesRepository;
  let users: UserRepository;
  let dataRooms: DataRoomRepository;
  let nodeRepository: NodeRepository;
  let nodes: NodeService;
  let shares: ShareRepository;
  let accessControl: AccessControlService;
  let demoGrants: DemoGrantService;

  beforeAll(async () => {
    prisma = await createTestPrisma();
    fixtures = new FixturesRepository(prisma);
    users = new UserRepository(prisma);
    dataRooms = new DataRoomRepository(prisma);
    nodeRepository = new NodeRepository(prisma);
    shares = new ShareRepository(prisma);
    nodes = new NodeService(nodeRepository, dataRooms);
    accessControl = new AccessControlService(dataRooms, shares, nodeRepository, users);
    demoGrants = new DemoGrantService(users, nodeRepository, shares, accessControl);
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  beforeEach(async () => {
    await fixtures.reset();
  });

  /** The demo owner, their room at the fixed id, the shared folder, and `Internal` beside it. */
  async function seedDemo(): Promise<UserRecord> {
    const owner = await users.upsertFromGoogle({
      providerAccountId: DEMO_PROVIDER_ACCOUNT_ID,
      email: DEMO_OWNER_EMAIL,
      emailVerified: true,
      name: DEMO_OWNER_NAME,
      avatarUrl: null,
    });

    await dataRooms.create(owner.id, DEMO_ROOM_NAME, DEMO_ROOM_ID);
    const scope = await accessControl.resolveForUser(owner.id, DEMO_ROOM_ID);

    const shared = await nodeRepository.createFolder(scope, {
      parentId: null,
      parentPath: '/',
      id: DEMO_SHARE_FOLDER_ID,
      name: DEMO_SHARE_FOLDER_NAME,
      createdById: owner.id,
    });
    await nodeRepository.createFolder(scope, {
      parentId: shared.id,
      parentPath: shared.path,
      name: 'Legal',
      createdById: owner.id,
    });
    await nodeRepository.createFolder(scope, {
      parentId: null,
      parentPath: '/',
      name: 'Internal',
      createdById: owner.id,
    });

    return owner;
  }

  async function signIn(
    overrides: Partial<{ email: string; emailVerified: boolean; providerAccountId: string }> = {},
  ): Promise<UserRecord> {
    const user = await users.upsertFromGoogle({
      providerAccountId: overrides.providerAccountId ?? 'google-reviewer',
      email: overrides.email ?? 'reviewer@example.com',
      emailVerified: overrides.emailVerified ?? true,
      name: 'Reviewer',
      avatarUrl: null,
    });
    await demoGrants.ensureGrantedTo(user);
    return user;
  }

  it('grants the shared folder, addressed by its fixed id', async () => {
    await seedDemo();
    const reviewer = await signIn();

    const held = await shares.findLiveGrantsForEmail(DEMO_ROOM_ID, reviewer.email);
    expect(held).toHaveLength(1);
    expect(held[0]?.nodeId).toBe(DEMO_SHARE_FOLDER_ID);
    expect(held[0]?.mode).toBe('USER');
    // No expiry: a demo that dies of old age reads as a bug.
    expect(held[0]?.expiresAt).toBeNull();
  });

  it('is idempotent across repeated sign-ins', async () => {
    await seedDemo();
    const reviewer = await signIn();
    await demoGrants.ensureGrantedTo(reviewer);
    await demoGrants.ensureGrantedTo(reviewer);

    expect(await shares.findLiveGrantsForEmail(DEMO_ROOM_ID, reviewer.email)).toHaveLength(1);
  });

  it('grants nothing to an unverified address', async () => {
    await seedDemo();
    // A grant written for an unverified address is worse than none: `resolveForUser`
    // matches verified emails only (decision #7), so the row would look like access and
    // never resolve.
    const user = await signIn({ email: 'unverified@example.com', emailVerified: false });

    expect(await shares.findLiveGrantsForEmail(DEMO_ROOM_ID, user.email)).toHaveLength(0);
  });

  it('grants nothing to the demo owner themselves', async () => {
    const owner = await seedDemo();
    await demoGrants.ensureGrantedTo(owner);

    expect(await shares.findLiveGrantsForEmail(DEMO_ROOM_ID, owner.email)).toHaveLength(0);
  });

  it('does nothing, and does not throw, when the database was never seeded', async () => {
    const user = await signIn();

    expect(await shares.findLiveGrantsForEmail(DEMO_ROOM_ID, user.email)).toHaveLength(0);
  });

  /**
   * The point of granting a **folder** rather than the whole room. A grantee's scope root is
   * the shared folder, so the room's name and its whole-room totals stay out of the
   * response, breadcrumbs start empty, and the sibling `Internal` is not merely hidden in
   * the UI — it is outside the boundary the query itself is bounded by.
   */
  it('resolves to a scope clipped at the shared folder', async () => {
    await seedDemo();
    const reviewer = await signIn();

    const scope = await accessControl.resolveForUser(reviewer.id, DEMO_ROOM_ID);
    expect(scope.rootNodeId).toBe(DEMO_SHARE_FOLDER_ID);
    expect(scope.role).toBe('VIEWER');

    const atRoot = await nodes.browse(scope);
    expect(atRoot.room).toBeUndefined();
    expect(atRoot.breadcrumbs).toHaveLength(0);
    expect(atRoot.children.map((child) => child.name)).toEqual(['Legal']);
  });
});
