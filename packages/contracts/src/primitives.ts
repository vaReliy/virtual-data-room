import { z } from 'zod';

/**
 * Every identifier that crosses the API boundary is a UUID. `path` is internal: it is
 * never accepted from a request and never returned to a client, so it has no schema here.
 */
export const uuidSchema = z.uuid();

/**
 * Sizes cross the wire as `number`, never `BigInt` — `JSON.stringify` throws on `bigint`.
 * `BigInt` stays in the database and the repository converts at its boundary.
 *
 * The bound is `Number.MAX_SAFE_INTEGER` (2^53 - 1 bytes, ~9 PB). The 200 MB Data Room
 * quota sits roughly 45 million times below it, so a byte count can never lose precision
 * on this side of the boundary.
 */
export const byteSizeSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);

/** A count of nodes in a subtree. Same reasoning as `byteSizeSchema`, smaller numbers. */
export const nodeCountSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);

/** A Node is a FOLDER or a FILE. Both live in one table; the type distinguishes them. */
export const nodeTypeSchema = z.enum(['FOLDER', 'FILE']);
export type NodeType = z.infer<typeof nodeTypeSchema>;
