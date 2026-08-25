import type { ConfigService } from '@nestjs/config';

import type { Env } from '../config/env';
import { PrismaService } from '../persistence/prisma.service';

/**
 * Where the integration tests run.
 *
 * A database of its own, beside the compose one rather than inside it: the harness
 * deletes every row between tests, and pointing that at the development database would
 * wipe the local sign-in on every run. `prisma migrate deploy` creates it on first use,
 * so a fresh clone needs no manual step beyond `docker compose up -d postgres`.
 */
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgresql://dataroom:dataroom@localhost:5432/dataroom_test';

/**
 * A `PrismaService` pointed at the test database.
 *
 * It is constructed directly rather than through a Nest testing module: these tests
 * exercise repositories and services as plain objects, and a DI container would add a
 * layer between the test and the SQL it is written to check. The `ConfigService` stand-in
 * exists only because `PrismaService` reads its connection string from one — the real
 * `validateEnv` would demand Google and storage credentials that no test needs.
 */
export async function createTestPrisma(): Promise<PrismaService> {
  const config = { get: () => TEST_DATABASE_URL } as unknown as ConfigService<Env, true>;
  const prisma = new PrismaService(config);
  await prisma.onModuleInit();
  return prisma;
}
