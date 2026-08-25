import { z } from 'zod';
import { uuidSchema } from './primitives';

/**
 * The signed-in user. `email` is normalized lower-case and comes from Google already
 * verified, which is what makes email-based grant matching sound.
 */
export const sessionUserSchema = z.object({
  id: uuidSchema,
  email: z.email(),
  name: z.string().nullable(),
  avatarUrl: z.url().nullable(),
});
export type SessionUser = z.infer<typeof sessionUserSchema>;
