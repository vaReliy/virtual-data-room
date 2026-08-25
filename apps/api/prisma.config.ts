import { resolve } from 'node:path';

import { defineConfig, env } from 'prisma/config';

/**
 * Prisma 7 moved connection configuration out of the schema: there is no `url` or
 * `directUrl` on the datasource block any more. The two-connection split that Neon needs
 * is unchanged, only relocated.
 *
 *   DATABASE_URL — pooled, used at runtime by the driver adapter in `prisma.service.ts`.
 *   DIRECT_URL   — direct, used here by `prisma migrate`. PgBouncer in transaction mode
 *                  cannot carry the session-level statements a migration issues, so this
 *                  must not be the pooled string.
 *
 * Prisma 7 no longer loads `.env` itself, so this file does it — via Node's built-in
 * `process.loadEnvFile`, which keeps the CLI free of a dotenv dependency that
 * `pnpm deploy --prod` would strip out of the production image. In Cloud Run there is no
 * `.env` and the real environment comes from Secret Manager, so a missing file is the
 * normal production case rather than an error.
 */
const rootEnvFile = resolve(__dirname, '../../.env');
try {
  process.loadEnvFile(rootEnvFile);
} catch {
  // No .env: the environment is already populated (Cloud Run, CI, compose).
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: env('DIRECT_URL'),
  },
});
