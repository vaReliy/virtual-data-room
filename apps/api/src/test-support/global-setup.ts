import { execFileSync } from 'node:child_process';

import { TEST_DATABASE_URL } from './database';

/**
 * Brings the test database up to the current schema once per run.
 *
 * `migrate deploy` rather than `migrate dev`: it applies the committed migrations and
 * nothing else, which is the same path the Cloud Run entrypoint takes — so the SQL the
 * tests run against is the SQL production runs against, including the five raw statements
 * the schema cannot express. It also creates the database if it does not exist yet.
 *
 * Both connection variables are set to the same string. The pooled/direct split exists
 * for Neon's PgBouncer; the compose Postgres has no pooler in front of it.
 */
export default function setup(): void {
  try {
    execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
      stdio: 'pipe',
      env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL, DIRECT_URL: TEST_DATABASE_URL },
    });
  } catch (cause) {
    throw new Error(
      `Could not migrate the integration-test database at ${TEST_DATABASE_URL}.\n` +
        'These tests need a real Postgres — the raw SQL they cover cannot be mocked.\n' +
        'Start it with: docker compose up -d postgres',
      { cause },
    );
  }
}
