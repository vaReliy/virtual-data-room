import { z } from 'zod';
import { byteSizeSchema, nodeCountSchema, uuidSchema } from './primitives';

/**
 * A Data Room as the owner's shell needs it. The aggregates are denormalized counters
 * maintained on every mutation, so reading them costs nothing and stays constant work
 * however large the room grows.
 */
export const dataRoomSummarySchema = z.object({
  id: uuidSchema,
  name: z.string(),
  totalSize: byteSizeSchema,
  fileCount: nodeCountSchema,
  folderCount: nodeCountSchema,
});
export type DataRoomSummary = z.infer<typeof dataRoomSummarySchema>;

/**
 * A Data Room as `GET /api/me` reports it: enough to route to, and nothing more.
 *
 * Narrower than `DataRoomSummary` on purpose (decision #24) — the aggregates belong to
 * whatever the caller is currently looking at, not to the session.
 */
export const dataRoomIdentitySchema = dataRoomSummarySchema.pick({ id: true, name: true });
export type DataRoomIdentity = z.infer<typeof dataRoomIdentitySchema>;
