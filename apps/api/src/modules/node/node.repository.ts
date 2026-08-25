import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import type { Breadcrumb, NodeType } from '@dr/contracts';

import type { AccessScope } from '../../access/access-scope';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService, type ExtendedPrismaClient } from '../../persistence/prisma.service';
import { NameConflictError } from './node.errors';

/**
 * A node as the rest of the API sees it. `path` is present because breadcrumbs and the
 * subtree statements are computed from it — the service clips it and never lets it out.
 *
 * `deletedAt` is present because exactly one method returns deleted rows, and its callers
 * are required by the type to decide what to do about them. See `findInScope`.
 */
export interface NodeRecord {
  id: string;
  parentId: string | null;
  type: NodeType;
  name: string;
  path: string;
  size: number;
  totalSize: number;
  fileCount: number;
  folderCount: number;
  updatedAt: Date;
  deletedAt: Date | null;
}

/** A node known to be live. Produced only by `NodeService.resolveLiveNode`. */
export type LiveNodeRecord = Omit<NodeRecord, 'deletedAt'>;

/**
 * A listed child, carrying the sort key Postgres itself computed.
 *
 * `lowerName` is not `name.toLowerCase()`: JavaScript's case folding is locale-invariant
 * while `lower()` follows the database collation, and the two disagree on inputs a user
 * can type. The cursor has to carry the value the `ORDER BY` actually used, or a page
 * boundary drops or repeats a row — the exact failure the sort key and the uniqueness
 * index were aligned to prevent.
 */
export type ListedNodeRecord = NodeRecord & { lowerName: string };

/**
 * The change a mutation makes to every ancestor's counters, and to the room's.
 * Positive on create and upload, negative on delete.
 */
export interface AggregateDelta {
  size: number;
  files: number;
  folders: number;
}

/**
 * An interactive transaction. Spelled as the client minus its connection-level methods,
 * which is what `$transaction` hands its callback — the extension travels with it, so a
 * Prisma read inside a transaction is still soft-delete filtered, and a raw one still is
 * not.
 */
export type TransactionClient = Omit<
  ExtendedPrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$extends'
>;

/**
 * The number of children one listing page returns. Keyset pagination makes the cost of a
 * page independent of how deep into the folder it sits, so this is a rendering choice
 * rather than a performance one: enough rows to fill a screen without scrolling being the
 * only way to discover there are more.
 */
export const LISTING_PAGE_SIZE = 50;

/** Columns every read projects, aliased to the field names the API uses. */
const NODE_COLUMNS = Prisma.sql`
  id,
  parent_id    AS "parentId",
  type,
  name,
  path,
  size,
  total_size   AS "totalSize",
  file_count   AS "fileCount",
  folder_count AS "folderCount",
  updated_at   AS "updatedAt",
  deleted_at   AS "deletedAt"
`;

/** The row shape the statements above return, before `BigInt` is converted away. */
interface RawNodeRow {
  id: string;
  parentId: string | null;
  type: NodeType;
  name: string;
  path: string;
  size: bigint;
  totalSize: bigint;
  fileCount: number;
  folderCount: number;
  updatedAt: Date;
  deletedAt: Date | null;
}

/**
 * Postgres reports a unique-index violation as SQLSTATE `23505`. Prisma normally
 * translates that to `P2002`, but `nodes_parent_name_unique` is created in raw SQL rather
 * than declared in the schema, so it cannot be assumed to be recognised — and a raw
 * statement is not translated at all. Both spellings are therefore matched, and the
 * driver error is followed through `cause`, where the adapter puts it.
 */
function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; current !== null && current !== undefined && depth < 5; depth += 1) {
    if (current instanceof Prisma.PrismaClientKnownRequestError && current.code === 'P2002') {
      return true;
    }
    const candidate = current as { code?: unknown; meta?: { code?: unknown }; cause?: unknown };
    if (candidate.code === '23505' || candidate.meta?.code === '23505') return true;
    current = candidate.cause;
  }
  return false;
}

/**
 * The tree. Every method takes an `AccessScope` first and bounds its query by
 * `path LIKE scope.rootPath || '%'`, in SQL — never in TypeScript. An application-level
 * comparison would rebuild the `findById` that must not exist and move the boundary into
 * a line someone can forget.
 *
 * This is the only file in the codebase permitted to run raw SQL (ESLint enforces it),
 * because **raw SQL bypasses the soft-delete extension entirely**: the extension rewrites
 * Prisma query arguments, and a raw statement never passes through that path. Every
 * statement here therefore filters `deleted_at IS NULL` itself — except `findInScope`,
 * whose whole purpose is that it does not.
 */
@Injectable()
export class NodeRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * **The only way to read a node by id**, and it always returns soft-deleted rows.
   *
   * There is deliberately no soft-delete-filtering twin to reach for by mistake: a second
   * "safe" `findById` is precisely how a `410` decays into a `404`. The return type
   * carries `deletedAt`, so every caller is forced to decide — and `NodeService`
   * concentrates that decision in `resolveLiveNode`.
   *
   * Scope lives in the `WHERE` clause, which makes the order the error contract requires
   * — scope before deletion — structural rather than a matter of discipline: the
   * statement cannot return an out-of-scope row, so the `410` branch is unreachable from
   * outside the scope.
   */
  async findInScope(scope: AccessScope, id: string): Promise<NodeRecord | null> {
    const rows = await this.prisma.client.$queryRaw<RawNodeRow[]>`
      SELECT ${NODE_COLUMNS}
      FROM nodes
      WHERE id = ${id}::uuid
        AND data_room_id = ${scope.dataRoomId}::uuid
        AND path LIKE ${scope.rootPath} || '%'
    `;
    const row = rows[0];
    return row ? this.toRecord(row) : null;
  }

  /**
   * The names behind a set of ancestor ids, for breadcrumbs. `path` carries UUIDs only,
   * so the names need a second, multi-id read.
   *
   * Scope-bounded and **live-only**: an ancestor above the caller's scope root is never
   * fetched, let alone returned — in an M&A context a folder name is itself confidential.
   * Ordered by `path`, not by the order the ids arrive in or the order Postgres happens
   * to return: an ancestor list in the wrong order is a wrong trail, not a cosmetic bug.
   */
  async findAncestorsInScope(scope: AccessScope, ids: readonly string[]): Promise<Breadcrumb[]> {
    if (ids.length === 0) return [];

    return this.prisma.client.$queryRaw<Breadcrumb[]>`
      SELECT id, name
      FROM nodes
      WHERE data_room_id = ${scope.dataRoomId}::uuid
        AND id IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))})
        AND path LIKE ${scope.rootPath} || '%'
        AND deleted_at IS NULL
      ORDER BY path
    `;
  }

  /**
   * One page of a folder's direct children, folders first and then by name.
   *
   * **This cannot go through Prisma.** `nodes_listing` is keyed on
   * `COALESCE(parent_id, data_room_id)`, which a `where: { parentId }` does not match; and
   * Prisma can express neither `ORDER BY lower(name)` nor the row-wise keyset comparison.
   *
   * `parentKey` is the child's parent id, or the Data Room's id for root-level children —
   * the same `COALESCE` the index and the uniqueness constraint are built on, so all
   * three agree about what "the same folder" means.
   *
   * The cursor compares `(type, lower(name))` as a row, which is exactly the index's
   * trailing key: constant-time per page however far in, and stable under concurrent
   * inserts in a way `OFFSET` is not. `type` is compared as the enum, not as text, so the
   * comparison keeps the declaration order the `ORDER BY` uses — folders before files.
   */
  async listChildrenInScope(
    scope: AccessScope,
    parentKey: string,
    after: { type: NodeType; lowerName: string } | null,
    limit: number,
  ): Promise<ListedNodeRecord[]> {
    const keyset = after
      ? Prisma.sql`AND (type, lower(name)) > (${after.type}::"NodeType", ${after.lowerName})`
      : Prisma.empty;

    const rows = await this.prisma.client.$queryRaw<(RawNodeRow & { lowerName: string })[]>`
      SELECT ${NODE_COLUMNS}, lower(name) AS "lowerName"
      FROM nodes
      WHERE data_room_id = ${scope.dataRoomId}::uuid
        AND COALESCE(parent_id, data_room_id) = ${parentKey}::uuid
        AND path LIKE ${scope.rootPath} || '%'
        AND deleted_at IS NULL
        ${keyset}
      ORDER BY type, lower(name)
      LIMIT ${limit}
    `;
    return rows.map((row) => ({ ...this.toRecord(row), lowerName: row.lowerName }));
  }

  /**
   * Inserts a folder and moves its ancestors' counters, in one transaction.
   *
   * **The id is generated here, before the insert**, rather than by the database: `path`
   * contains the node's own id and is `NOT NULL`, so a database-side default is not known
   * in time to build it.
   *
   * The insert itself goes through Prisma — nothing about it needs raw SQL, and Prisma
   * fills `created_at` / `updated_at`, which have no database defaults.
   */
  async createFolder(
    scope: AccessScope,
    input: { parentId: string | null; parentPath: string; name: string; createdById: string },
  ): Promise<NodeRecord> {
    const id = randomUUID();
    const path = `${input.parentPath}${id}/`;

    try {
      return await this.prisma.client.$transaction(async (tx) => {
        const created = await tx.node.create({
          data: {
            id,
            dataRoomId: scope.dataRoomId,
            parentId: input.parentId,
            type: 'FOLDER',
            name: input.name,
            path,
            createdById: input.createdById,
          },
        });

        await this.applyAggregateDelta(tx, scope, ancestorIdsOf(input.parentPath), {
          size: 0,
          files: 0,
          folders: 1,
        });

        return this.toRecord(created);
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new NameConflictError(input.name);
      throw error;
    }
  }

  /**
   * Renames a node. No aggregate moves: a rename changes neither sizes nor counts.
   *
   * The `where` is by id alone because the caller has already resolved this node through
   * `findInScope`, which is the scope check. Renaming to a name that differs only in case
   * is not a conflict — the only row holding that index key is this one.
   */
  async rename(scope: AccessScope, id: string, name: string): Promise<NodeRecord> {
    try {
      const updated = await this.prisma.client.node.update({ where: { id }, data: { name } });
      return this.toRecord(updated);
    } catch (error) {
      if (isUniqueViolation(error)) throw new NameConflictError(name);
      throw error;
    }
  }

  /**
   * Soft-deletes a node and everything beneath it, and takes the ancestors' counters down
   * by exactly what was stamped.
   *
   * **`AND deleted_at IS NULL` is what makes this correct, not what makes it tidy.** The
   * statement is raw, so the soft-delete extension does not touch it; without that
   * predicate a second delete re-stamps rows that were already deleted and decrements the
   * ancestors for them a second time. Nothing crashes — the delete-warning dialog simply
   * shows a wrong number.
   *
   * The delta is derived from `RETURNING` on that same statement, so the rows counted and
   * the rows stamped cannot disagree. The `UPDATE` and the ancestor update are one
   * transaction: a delta applied outside it can be lost against a stamp that was not.
   *
   * This is the **single writer** of `deleted_at` on `nodes`, and it must stay that way.
   * "A node under a deleted ancestor is itself deleted" is an assumption the `410` design
   * rests on, not a constraint the database enforces: a second writer would leave live
   * rows under a deleted ancestor, missing from their parent's listing and still readable
   * by direct id — a deleted document served to a counterparty.
   */
  async deleteSubtree(scope: AccessScope, node: LiveNodeRecord): Promise<AggregateDelta> {
    return this.prisma.client.$transaction(async (tx) => {
      const stamped = await tx.$queryRaw<{ type: NodeType; size: bigint }[]>`
        UPDATE nodes
        SET deleted_at = now(), updated_at = now()
        WHERE data_room_id = ${scope.dataRoomId}::uuid
          AND path LIKE ${node.path} || '%'
          AND path LIKE ${scope.rootPath} || '%'
          AND deleted_at IS NULL
        RETURNING type, size
      `;

      const delta: AggregateDelta = {
        size: -stamped.reduce((total, row) => total + Number(row.size), 0),
        files: -stamped.filter((row) => row.type === 'FILE').length,
        folders: -stamped.filter((row) => row.type === 'FOLDER').length,
      };

      // Strict ancestors only. The deleted node's own counters are frozen along with it:
      // it is gone, and nothing reads them again.
      await this.applyAggregateDelta(tx, scope, ancestorIdsOf(node.path).slice(0, -1), delta);

      return delta;
    });
  }

  /**
   * Moves subtree counters onto every ancestor **and onto the Data Room**, inside the
   * caller's transaction.
   *
   * The room is not covered by the ancestor update and never could be: a root-level node
   * has no ancestors at all, so `ancestorIds` is empty and nothing would be updated. Its
   * counters are whole-room totals, and since decision #24 they are what the browser
   * header renders at the room root — a drift there is visible, not latent.
   *
   * Five calls from four call sites: create and delete here, upload-complete and move in
   * Phase 3 — move calling it **twice**, once negative off the old ancestor chain and once
   * positive onto the new one. The two room updates net to zero, which is correct: a move
   * relocates a subtree inside one room and changes no whole-room total.
   *
   * Restore is not one of them and never will be — decision #6 ships no trash UI.
   *
   * Bounded by `scope.dataRoomId`, and deliberately **not** clipped to `scope.rootPath`:
   * the counters of an ancestor above a share root still have to be right, and the ids
   * come from the node's own `path` rather than from a request. It is recorded in the
   * scope-exception inventory in `architecture.md` for that reason.
   */
  async applyAggregateDelta(
    tx: TransactionClient,
    scope: AccessScope,
    ancestorIds: readonly string[],
    delta: AggregateDelta,
  ): Promise<void> {
    const counters = {
      totalSize: { increment: delta.size },
      fileCount: { increment: delta.files },
      folderCount: { increment: delta.folders },
    };

    if (ancestorIds.length > 0) {
      await tx.node.updateMany({
        where: { id: { in: [...ancestorIds] }, dataRoomId: scope.dataRoomId },
        data: counters,
      });
    }

    await tx.dataRoom.update({ where: { id: scope.dataRoomId }, data: counters });
  }

  /**
   * `BigInt` stops here. `JSON.stringify` throws on a bigint, so sizes cross the wire as
   * `number` — safe by a wide margin, since the 200 MB quota is ~45 million times below
   * `Number.MAX_SAFE_INTEGER`. `BigInt` stays in the database.
   */
  private toRecord(row: RawNodeRow): NodeRecord {
    return {
      id: row.id,
      parentId: row.parentId,
      type: row.type,
      name: row.name,
      path: row.path,
      size: Number(row.size),
      totalSize: Number(row.totalSize),
      fileCount: row.fileCount,
      folderCount: row.folderCount,
      updatedAt: row.updatedAt,
      deletedAt: row.deletedAt,
    };
  }
}

/**
 * The ids in a path, in order, from the room root downwards. `'/a/b/'` is `['a', 'b']`,
 * and `'/'` is `[]` — a string split, never a query, which is what keeps a permission
 * check and an aggregate update constant work however deep the tree goes.
 */
export function ancestorIdsOf(path: string): string[] {
  return path.split('/').filter(Boolean);
}
