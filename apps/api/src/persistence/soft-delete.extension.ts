import { Prisma } from '../generated/prisma/client';

/**
 * Soft delete (decision #6) is a read filter, not a delete. Every read of a
 * soft-deletable model is narrowed to `deletedAt: null` here, once, so that no
 * repository can forget it.
 *
 * Two things this does NOT cover, both deliberate:
 *
 *  - **Raw SQL bypasses it entirely.** The extension rewrites Prisma query arguments;
 *    a raw statement never passes through that path. Every raw statement in
 *    `node.repository.ts` must therefore filter `deleted_at IS NULL` itself. The subtree
 *    delete is the one that bites: without it a second delete re-stamps already-deleted
 *    rows and decrements ancestor aggregates twice.
 *  - **The two intentional bypasses** need to see deleted rows, because `404` (never
 *    existed) and `410` (deleted while you were looking at it) are different states with
 *    different screens. Both call `$queryRaw` on purpose — note that the injected
 *    `deletedAt: null` below overwrites a caller-supplied one, so there is no
 *    argument-level opt-out by design.
 *      1. `NodeRepository.findInScope(scope, id)` — the only way to read a node by id.
 *         Still scope-bounded in SQL; it drops just the `deleted_at` predicate.
 *      2. The `dataRoomId`-bounded lookup that takes no `AccessScope`, used to resolve a
 *         grant from a target node's ancestors. It arrives with sharing, not before —
 *         owner resolution never reads a node.
 */
const SOFT_DELETABLE_MODELS = ['DataRoom', 'Node'] as const;

/**
 * Reads that take a `where` and must be narrowed. `findUnique` is deliberately absent:
 * its `where` accepts only unique fields, so it cannot carry `deletedAt`. Repositories
 * use `findFirst` instead, which this list does cover.
 */
const FILTERED_READS = new Set([
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
]);

/** `findUnique` cannot express the filter, so reaching for it is a mistake, not a choice. */
const UNSUPPORTED_READS = new Set(['findUnique', 'findUniqueOrThrow']);

type QueryArgs = { where?: Record<string, unknown> };

export const softDeleteExtension = Prisma.defineExtension({
  name: 'soft-delete-read-filter',
  query: {
    $allModels: {
      $allOperations({ model, operation, args, query }) {
        const isSoftDeletable = (SOFT_DELETABLE_MODELS as readonly string[]).includes(model);
        if (!isSoftDeletable) return query(args);

        if (UNSUPPORTED_READS.has(operation)) {
          throw new Error(
            `${model}.${operation} cannot carry the soft-delete filter — its where clause ` +
              `accepts only unique fields. Use findFirst, or go through one of the two ` +
              `documented bypasses if you genuinely need to see deleted rows.`,
          );
        }

        if (!FILTERED_READS.has(operation)) return query(args);

        const typedArgs = (args ?? {}) as QueryArgs;
        return query({
          ...typedArgs,
          where: { ...(typedArgs.where ?? {}), deletedAt: null },
        });
      },
    },
  },
});
