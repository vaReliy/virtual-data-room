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
