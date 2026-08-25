import { z } from 'zod';
import { dataRoomSummarySchema } from './data-room';
import { sessionUserSchema } from './user';

/**
 * `GET /api/me` — who is signed in and which Data Rooms they own, in one call, because
 * the authenticated shell renders both on every load.
 *
 * `dataRooms` is an array even though the UI stays single-room (decision #21): the schema
 * is multi-room, and a switcher appears only once a user actually has more than one.
 */
export const meResponseSchema = z.object({
  user: sessionUserSchema,
  dataRooms: z.array(dataRoomSummarySchema),
});
export type MeResponse = z.infer<typeof meResponseSchema>;
