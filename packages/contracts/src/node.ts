import { z } from 'zod';
import { dataRoomSummarySchema } from './data-room';
import { byteSizeSchema, nodeCountSchema, nodeTypeSchema, uuidSchema } from './primitives';

/**
 * Characters a node name may not contain, and the two names it may not be.
 *
 * None of them reach storage — object keys are UUIDs — but all of them make a breadcrumb
 * or a download filename behave strangely: `/` splits a display path, NUL and the C0
 * control range are invisible in a table cell, and `.` / `..` read as traversal wherever
 * a name is echoed.
 */
// eslint-disable-next-line no-control-regex -- the C0 range is exactly what is rejected.
const REJECTED_CHARACTERS = /[/\u0000-\u001F]/;
const REJECTED_NAMES = new Set(['.', '..']);

/**
 * One schema for both request bodies and both dialog resolvers, so the client and the
 * server reject the same strings for the same reasons.
 *
 * `.trim()` runs first — normalization at the edge (decision #12). Without it `"Legal "`
 * and `"Legal"` are two rows whose `lower(name)` collide only sometimes, which is the
 * confusing half of a uniqueness bug. Length is measured after trimming, so a name of
 * nothing but spaces is a `422`, not a silent no-op.
 *
 * Case is preserved for display while uniqueness is on `lower(name)`, so renaming
 * `Legal` to `legal` succeeds: the only row holding that index key is the row being
 * updated, and it does not collide with itself.
 */
export const nodeNameSchema = z
  .string()
  .trim()
  .min(1, 'A name is required.')
  .max(255, 'A name may be at most 255 characters.')
  .refine((name) => !REJECTED_CHARACTERS.test(name), {
    message: 'A name may not contain slashes or control characters.',
  })
  .refine((name) => !REJECTED_NAMES.has(name), { message: 'That name is reserved.' });

/**
 * What the caller may do inside the scope this response was resolved against. It travels
 * with every browse response because the same route serves the owner and the recipient of
 * a `USER` share (decision #24), and the client has nothing else to hide "New folder",
 * "Rename" and "Delete" behind.
 *
 * Hiding a button is not access control — the server refuses the write regardless
 * (decision #25). This is presentation only.
 */
export const roleSchema = z.enum(['OWNER', 'VIEWER']);
export type Role = z.infer<typeof roleSchema>;

/**
 * A node as every screen needs it. Deliberately absent: `path`, which is internal and
 * built from UUIDs — never accepted from a request, never returned to a client.
 *
 * `parentId` is `null` at the caller's scope root as well as at the room root, so a
 * client walking upwards stops instead of asking for a node it cannot see.
 *
 * The four aggregate fields are denormalized counters maintained on every mutation
 * (decision #5), which is why a folder can show its whole subtree's totals without a
 * subtree scan. On a `FILE` they are zero and `size` carries the blob's bytes.
 */
export const nodeSummarySchema = z.object({
  id: uuidSchema,
  parentId: uuidSchema.nullable(),
  type: nodeTypeSchema,
  name: z.string(),
  size: byteSizeSchema,
  totalSize: byteSizeSchema,
  fileCount: nodeCountSchema,
  folderCount: nodeCountSchema,
  updatedAt: z.iso.datetime(),
});
export type NodeSummary = z.infer<typeof nodeSummarySchema>;

/** One step of the ancestry, clipped to the caller's scope root. Nothing above it exists. */
export const breadcrumbSchema = z.object({
  id: uuidSchema,
  name: z.string(),
});
export type Breadcrumb = z.infer<typeof breadcrumbSchema>;

/**
 * `GET /api/rooms/:roomId/nodes/:nodeId?` — everything the browser renders, in one call
 * (decision #24).
 *
 * - `node: null` means the caller is standing at their scope root. There is no row there
 *   to describe, and a synthetic one with a fabricated id eventually gets treated as real.
 * - `breadcrumbs` is `[]` at that root, and never reaches above it: in an M&A context a
 *   folder name is itself confidential.
 * - `room` is present **only** when `scope.rootNodeId === null`. A subtree-scoped caller
 *   must not learn the room's name or its whole-room totals — both sit above their scope.
 * - `nextCursor` is `null` on the last page. It is opaque (decision #13): clients pass it
 *   back untouched and never construct one.
 */
export const browseResponseSchema = z.object({
  room: dataRoomSummarySchema.optional(),
  node: nodeSummarySchema.nullable(),
  breadcrumbs: z.array(breadcrumbSchema),
  children: z.array(nodeSummarySchema),
  nextCursor: z.string().nullable(),
  role: roleSchema,
});
export type BrowseResponse = z.infer<typeof browseResponseSchema>;

/**
 * `POST /api/rooms/:roomId/nodes` — create a folder.
 *
 * There is no `type` field: Phase 2 creates folders only, and a `FILE` node is born in
 * `POST /api/rooms/:roomId/uploads/complete`, never here, because it cannot exist without
 * a `READY` blob. `parentId: null` means the caller's scope root.
 */
export const createFolderBodySchema = z.object({
  parentId: uuidSchema.nullable(),
  name: nodeNameSchema,
});
export type CreateFolderBody = z.infer<typeof createFolderBodySchema>;

/** `PATCH /api/rooms/:roomId/nodes/:nodeId` — rename, and nothing else. */
export const renameNodeBodySchema = z.object({
  name: nodeNameSchema,
});
export type RenameNodeBody = z.infer<typeof renameNodeBodySchema>;

/**
 * `POST /api/rooms/:roomId/nodes/:nodeId/move` — a dedicated sub-resource, not a field on
 * `PATCH`.
 *
 * Folding `parentId` into the rename body makes `{ "parentId": null }` — move to the room
 * root — indistinguishable from a `parentId` the client simply did not send, which is the
 * difference between relocating a node and leaving it alone. The operation is also not a
 * field write: it rewrites every descendant's `path` and transfers aggregates between two
 * ancestor chains.
 */
export const moveNodeBodySchema = z.object({
  parentId: uuidSchema.nullable(),
});
export type MoveNodeBody = z.infer<typeof moveNodeBodySchema>;
