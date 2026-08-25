import { z } from 'zod';
import { dataRoomIdentitySchema } from './data-room';
import { sessionUserSchema } from './user';

/**
 * `GET /api/me` — identity and what exists, and deliberately nothing about content.
 *
 * The aggregates that used to live here moved onto the browse response (decision #24).
 * They were free in Phase 1 because nothing could change them; from Phase 2 every folder
 * create and delete does, so keeping them here would mean invalidating the session query
 * on a content mutation and caching the same three numbers in two places.
 *
 * `dataRooms` stays an array even though a user owns exactly one room (decision #23): the
 * schema is multi-room, and an empty array is an **error** state — provisioning failed —
 * rather than an empty one, because there is no create-room affordance to offer instead.
 */
export const meResponseSchema = z.object({
  user: sessionUserSchema,
  dataRooms: z.array(dataRoomIdentitySchema),
});
export type MeResponse = z.infer<typeof meResponseSchema>;
