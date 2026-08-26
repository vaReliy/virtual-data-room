import { z } from 'zod';

/**
 * Every variable the API reads, validated once at boot. A missing or malformed value
 * fails the process immediately rather than surfacing as a confusing runtime error on
 * the first request that happens to need it. `.env.example` documents the same set.
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),

  // Pooled at runtime, direct for migrations. See prisma.config.ts.
  DATABASE_URL: z.string().min(1),
  DIRECT_URL: z.string().min(1),

  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  GOOGLE_CALLBACK_URL: z.url(),

  // The origin the browser sees. Both the SPA and /api/* live here, which is what makes
  // the session cookie first-party (decision #10).
  APP_URL: z.url(),
  // 32 bytes minimum: this signs the session JWT.
  SESSION_SECRET: z.string().min(32),

  /**
   * How many reverse proxies sit in front of this process, for Express's `trust proxy`.
   *
   * It exists for exactly one reader — the anonymous share surface's rate limit, which is
   * keyed on `req.ip` — and it is a **deployment fact rather than a preference**, which is
   * why it is an environment variable and not a constant. Too high and a caller can spoof
   * `X-Forwarded-For` past the limit; too low and every caller collapses into one bucket,
   * which is the failure `session-throttler.guard.ts` documents.
   *
   * `0` — no trust — is the default because it is the safe direction: a shared bucket
   * limits too much, a spoofable one limits nothing. Locally it is also correct, since
   * Vite's proxy adds no forwarding header.
   */
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(10).default(0),

  STORAGE_ENDPOINT: z.url(),
  STORAGE_REGION: z.string().min(1),
  STORAGE_BUCKET: z.string().min(1),
  STORAGE_ACCESS_KEY_ID: z.string().min(1),
  STORAGE_SECRET_ACCESS_KEY: z.string().min(1),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }
  return parsed.data;
}
