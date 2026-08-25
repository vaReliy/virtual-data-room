import { z } from 'zod';

/** `GET /api/health` — liveness for Cloud Run and for the compose stack. */
export const healthResponseSchema = z.object({
  status: z.literal('ok'),
});
export type HealthResponse = z.infer<typeof healthResponseSchema>;
