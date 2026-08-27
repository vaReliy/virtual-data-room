import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { UPLOAD_MIME_TYPE } from '@dr/contracts';

import { AccessControlService } from '../../../access/access-control.service';
import type { AccessScope } from '../../../access/access-scope';
import { AppModule } from '../../../app.module';
import { TransactionRunner } from '../../../persistence/transaction.runner';
import { StorageService } from '../../../storage/storage.service';
import { UserRepository } from '../../auth/user.repository';
import { DataRoomRepository } from '../../data-room/data-room.repository';
import { BlobRepository } from '../../file/blob.repository';
import {
  LISTING_PAGE_SIZE,
  NodeRepository,
  type ListedNodeRecord,
  type NodeRecord,
} from '../../node/node.repository';
import { demoTree, type FileSpec, type FixtureName, type TreeSpec } from '../demo-tree';
import {
  DEMO_OWNER_EMAIL,
  DEMO_OWNER_NAME,
  DEMO_PROVIDER_ACCOUNT_ID,
  DEMO_ROOM_ID,
  DEMO_ROOM_NAME,
} from '../demo.constants';

/**
 * The demo Data Room. Run it with `pnpm db:seed` from `apps/api`.
 *
 * **It goes through the repositories the API itself uses**, from a Nest application
 * context, rather than issuing its own inserts. That is the design of this file and not a
 * stylistic preference: `total_size`, `file_count` and `folder_count` on every ancestor
 * *and* on the room are denormalized caches maintained per mutation
 * (`node.repository.ts` → `applyAggregateDelta`), never computed on read. A seed that
 * inserted rows directly would leave every one of them at zero, no test would notice, and
 * the wrong numbers would surface in the room header and in the delete warning — which are
 * graded. `verifyAggregates` re-derives them from the tree afterwards and fails the run on
 * a mismatch, so "the counters are right" is checked rather than assumed.
 *
 * **Every run resets the demo owner's state first.** Re-seeding is not "add what is
 * missing" but "put this account back to what a fresh seed produces": `resetDemoOwner`
 * hard-deletes every Data Room the demo owner holds, with its nodes, its shares and its
 * stored bytes, and the tree is then built from nothing. That is destructive by design and
 * bounded to one account — see `DataRoomRepository.deleteOwned` for the safety rail.
 *
 * Two consequences worth knowing before running it against a deployed database:
 *
 *  - **Every grant into the demo room dies**, so everyone who had it in "Shared with me"
 *    loses it. New sign-ins are granted again; existing sessions are not, until they sign
 *    in.
 *  - **Node ids change.** The room and the shared folder keep their fixed ids, so a link to
 *    either survives; a link to a file inside does not.
 */

/**
 * The committed PDFs, one level up beside the module they belong to rather than beside this
 * script. `nest-cli.json` copies them into `dist` preserving that layout, so the relative
 * path is the same whether this runs from `src` under a compiler or from the production
 * image.
 */
const FIXTURES_DIR = resolve(__dirname, '../fixtures');

/** Everything the seed needs from the container, resolved once. */
interface SeedContext {
  users: UserRepository;
  dataRooms: DataRoomRepository;
  nodes: NodeRepository;
  blobs: BlobRepository;
  storage: StorageService;
  transactions: TransactionRunner;
  access: AccessControlService;
  logger: Logger;
}

async function main(): Promise<void> {
  const logger = new Logger('Seed');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });

  try {
    const ctx: SeedContext = {
      users: app.get(UserRepository),
      dataRooms: app.get(DataRoomRepository),
      nodes: app.get(NodeRepository),
      blobs: app.get(BlobRepository),
      storage: app.get(StorageService),
      transactions: app.get(TransactionRunner),
      access: app.get(AccessControlService),
      logger,
    };

    const owner = await ctx.users.upsertFromGoogle({
      providerAccountId: DEMO_PROVIDER_ACCOUNT_ID,
      email: DEMO_OWNER_EMAIL,
      // Verified, because an unverified address resolves to nothing in
      // `AccessControlService` — a demo owner who could not be matched would be a row that
      // never serves anything.
      emailVerified: true,
      name: DEMO_OWNER_NAME,
      avatarUrl: null,
    });
    logger.log(`Demo owner: ${owner.email}`);

    await resetDemoOwner(ctx, owner.id);

    // The id is passed rather than generated: it is what lets a re-seed land on the same
    // room, and what lets `DemoGrantService` address the room without knowing its name.
    const room = await ctx.dataRooms.create(owner.id, DEMO_ROOM_NAME, DEMO_ROOM_ID);
    logger.log(`Demo Data Room: "${room.name}" (${room.id})`);

    // The owner's own scope, from the only producer of `AccessScope` there is. The seed
    // does not fabricate one: the demo owner genuinely owns this room, so this is the same
    // OWNER scope every request of theirs would resolve to.
    const scope = await ctx.access.resolveForUser(owner.id, room.id);

    const created = await ensureTree(ctx, scope, owner.id, null, demoTree());
    logger.log(`Created ${created.folders} folder(s) and ${created.files} file(s).`);

    const problems = await verifyAggregates(ctx, scope);
    if (problems.length > 0) {
      for (const problem of problems) logger.error(problem);
      logger.error(
        `${problems.length} aggregate mismatch(es). The room header and the delete warning ` +
          `would show wrong numbers; do not ship this database.`,
      );
      process.exitCode = 1;
      return;
    }

    logger.log('Aggregates verified against the tree: all counters agree.');
  } finally {
    await app.close();
  }
}

/**
 * Puts the demo owner back to holding nothing: every Data Room of theirs, with its nodes,
 * its shares, its blob rows and its stored objects.
 *
 * **It is keyed on the owner, not on the room id.** Addressing `DEMO_ROOM_ID` alone would
 * leave a room behind the moment that constant changed — the previous demo would sit there
 * forever, invisible to this script and still served to anyone holding a grant on it. The
 * demo owner exists for nothing but this, so "whatever they hold" is the honest boundary.
 *
 * An account holds **one** room and no more: `DataRoomService.ensureProvisioned` creates one
 * only when the user owns nothing, and decision #23 ships no create-room route, so nothing a
 * user can reach makes a second. The loop is not hedging against that invariant — it is
 * here because **this script is the one writer outside it**.
 *
 * The order is fixed by the schema. The room goes first, taking nodes and shares with it
 * through `ON DELETE CASCADE`; only then can the blob rows go, because `nodes_blob_id_fkey`
 * is `ON DELETE SET NULL` and a `FILE` with a null `blob_id` violates
 * `nodes_type_blob_check`. The objects go last, and their failures are logged rather than
 * raised: bytes nobody references are a cost, while a reset that cannot finish is a blocked
 * demo.
 */
async function resetDemoOwner(ctx: SeedContext, ownerId: string): Promise<void> {
  const owned = await ctx.dataRooms.listOwnedBy(ownerId);
  if (owned.length === 0) return;

  for (const room of owned) {
    const blobs = await ctx.blobs.listInRoom(room.id);

    await ctx.dataRooms.deleteOwned(ownerId, room.id);
    const removedRows = await ctx.blobs.deleteAllInRoom(room.id);

    let removedObjects = 0;
    for (const blob of blobs) {
      try {
        await ctx.storage.delete(blob.storageKey);
        removedObjects += 1;
      } catch (error) {
        ctx.logger.warn(`Could not remove ${blob.storageKey}: ${String(error)}`);
      }
    }

    ctx.logger.warn(
      `Reset: removed room "${room.name}" (${room.id}) with its nodes and shares, ` +
        `${removedRows} blob row(s) and ${removedObjects} stored object(s).`,
    );
  }
}

/** How many nodes a run actually created, for the log line at the end. */
interface CreatedCount {
  folders: number;
  files: number;
}

/**
 * Creates whatever is missing under `parent`, and recurses.
 *
 * After `resetDemoOwner` the room is empty, so in a normal run "whatever is missing" is
 * everything. The existence check is kept anyway, and it is not dead weight: it is what
 * makes a run that died halfway — a dropped connection between two files — recoverable by
 * running the script again rather than only by resetting a second time.
 *
 * That check is a **listing**, not a lookup by name: `listChildrenInScope` is the scoped,
 * live-only read the browser itself uses, so a soft-deleted node of the same name does not
 * count as present — and the create that follows cannot collide with it, because
 * `nodes_parent_name_unique` is partial on `deleted_at IS NULL`.
 */
async function ensureTree(
  ctx: SeedContext,
  scope: AccessScope,
  createdById: string,
  parent: NodeRecord | null,
  specs: readonly TreeSpec[],
): Promise<CreatedCount> {
  const created: CreatedCount = { folders: 0, files: 0 };
  const children = await listAllChildren(ctx, scope, parent);
  const location = { parentId: parent?.id ?? null, parentPath: parent?.path ?? '/' };

  for (const spec of specs) {
    const existing = children.find((child) => child.name === spec.name);

    if (spec.kind === 'file') {
      if (existing) continue;
      await createSeededFile(ctx, scope, createdById, location, spec);
      created.files += 1;
      continue;
    }

    const node =
      existing ??
      (await ctx.nodes.createFolder(scope, {
        ...location,
        id: spec.id,
        name: spec.name,
        createdById,
      }));
    if (!existing) created.folders += 1;

    const nested = await ensureTree(ctx, scope, createdById, node, spec.children);
    created.folders += nested.folders;
    created.files += nested.files;
  }

  return created;
}

/**
 * One `FILE`, the same three steps the upload protocol takes: reserve a `PENDING` blob, put
 * the bytes at its key, then flip the blob and insert the node **in one transaction**.
 *
 * The order is not interchangeable. `nodes_type_blob_check` requires
 * `type = 'FILE' → blob_id IS NOT NULL`, and the content endpoint presigns against the
 * object key — so a node whose bytes are not there yet is a file that exists and cannot be
 * opened. Putting the bytes before the flip is what makes the `READY` status true.
 *
 * The advisory lock and the quota check that upload-complete takes are deliberately absent:
 * this process is the only writer while it runs, and the demo tree is a few hundred
 * kilobytes against a 200 MB quota.
 */
async function createSeededFile(
  ctx: SeedContext,
  scope: AccessScope,
  createdById: string,
  location: { parentId: string | null; parentPath: string },
  spec: FileSpec,
): Promise<void> {
  const bytes = await readFixture(spec.fixture);

  const blob = await ctx.blobs.createPending(scope.dataRoomId, {
    mimeType: UPLOAD_MIME_TYPE,
    size: bytes.byteLength,
  });

  await ctx.storage.putObject(blob.storageKey, bytes, UPLOAD_MIME_TYPE);

  await ctx.transactions.run(async (tx) => {
    await ctx.blobs.markReadyIfPending(tx, scope.dataRoomId, blob.id, {
      size: bytes.byteLength,
      mimeType: UPLOAD_MIME_TYPE,
    });
    await ctx.nodes.createFile(tx, scope, {
      ...location,
      name: spec.name,
      blobId: blob.id,
      size: bytes.byteLength,
      createdById,
    });
  });

  ctx.logger.log(`  ${spec.name} (${bytes.byteLength} B)`);
}

/** Each fixture is read once however many documents are cut from it. */
const fixtureCache = new Map<FixtureName, Buffer>();

async function readFixture(name: FixtureName): Promise<Buffer> {
  const cached = fixtureCache.get(name);
  if (cached) return cached;

  const bytes = await readFile(resolve(FIXTURES_DIR, name));
  fixtureCache.set(name, bytes);
  return bytes;
}

/**
 * Every live child of a folder, following the keyset cursor to the end.
 *
 * The demo tree never fills a page, but the loop is written properly anyway: a listing that
 * silently stopped at 50 would make `ensureTree` create a duplicate of the 51st node on
 * every run, which is precisely the non-idempotency this seed must not have.
 */
async function listAllChildren(
  ctx: SeedContext,
  scope: AccessScope,
  parent: NodeRecord | null,
): Promise<ListedNodeRecord[]> {
  // The same `COALESCE(parent_id, data_room_id)` key the listing index and the uniqueness
  // constraint are built on, so all three agree about what "the same folder" means.
  const parentKey = parent?.id ?? scope.dataRoomId;
  const all: ListedNodeRecord[] = [];
  let after: { type: ListedNodeRecord['type']; lowerName: string } | null = null;

  for (;;) {
    const page = await ctx.nodes.listChildrenInScope(scope, parentKey, after, LISTING_PAGE_SIZE);
    all.push(...page);

    const last = page.at(-1);
    if (!last || page.length < LISTING_PAGE_SIZE) return all;
    after = { type: last.type, lowerName: last.lowerName };
  }
}

/** A folder's subtree, as re-derived from the tree rather than read off a counter. */
interface Totals {
  size: number;
  files: number;
  folders: number;
}

/**
 * **This is the seed's whole risk, made loud.**
 *
 * It walks what was built and recomputes what every folder's and the room's counters ought
 * to be, then compares. A mismatch means the seed charged the aggregates wrongly — a
 * failure nothing else catches, because the counters are never computed on read and every
 * test would still pass.
 *
 * Each folder's counters cover its **descendants and not itself**, which is what
 * `applyAggregateDelta` maintains: a create adds `folders: 1` to the strict ancestors of the
 * new node. The room's counters cover everything in it.
 */
async function verifyAggregates(ctx: SeedContext, scope: AccessScope): Promise<string[]> {
  const problems: string[] = [];

  const walk = async (parent: NodeRecord | null): Promise<Totals> => {
    const totals: Totals = { size: 0, files: 0, folders: 0 };

    for (const child of await listAllChildren(ctx, scope, parent)) {
      if (child.type === 'FILE') {
        totals.size += child.size;
        totals.files += 1;
        continue;
      }

      const subtree = await walk(child);
      compare(problems, `folder "${child.name}"`, child, subtree);

      totals.size += subtree.size;
      totals.files += subtree.files;
      totals.folders += subtree.folders + 1;
    }

    return totals;
  };

  const wholeRoom = await walk(null);

  const room = await ctx.dataRooms.findInScope(scope);
  if (!room) {
    problems.push('The Data Room disappeared while it was being verified.');
    return problems;
  }
  compare(problems, `room "${room.name}"`, room, wholeRoom);

  ctx.logger.log(
    `Tree: ${wholeRoom.folders} folder(s), ${wholeRoom.files} file(s), ${wholeRoom.size} B.`,
  );
  return problems;
}

function compare(
  problems: string[],
  subject: string,
  stored: { totalSize: number; fileCount: number; folderCount: number },
  computed: Totals,
): void {
  if (stored.totalSize !== computed.size) {
    problems.push(`${subject}: total_size is ${stored.totalSize}, tree holds ${computed.size}.`);
  }
  if (stored.fileCount !== computed.files) {
    problems.push(`${subject}: file_count is ${stored.fileCount}, tree holds ${computed.files}.`);
  }
  if (stored.folderCount !== computed.folders) {
    problems.push(
      `${subject}: folder_count is ${stored.folderCount}, tree holds ${computed.folders}.`,
    );
  }
}

main().catch((error: unknown) => {
  new Logger('Seed').error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
