import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';

import type { Env } from '../config/env';
import { PrismaClient } from '../generated/prisma/client';
import { softDeleteExtension } from './soft-delete.extension';

function createClient(databaseUrl: string) {
  // Prisma 7 talks to Postgres through a driver adapter, so the pooled connection string
  // is handed to node-postgres here rather than declared on a datasource block. The
  // direct connection migrations need lives in prisma.config.ts and never reaches this
  // path, which is what keeps the two from being confused for one another.
  const adapter = new PrismaPg({ connectionString: databaseUrl });
  return new PrismaClient({ adapter }).$extends(softDeleteExtension);
}

/**
 * Host and database name only — never the credentials. This line is what makes an
 * accidental "local run against production" visible in the first second of a boot.
 */
function describeTarget(databaseUrl: string): string {
  try {
    const url = new URL(databaseUrl);
    return `${url.hostname}:${url.port || '5432'}${url.pathname}`;
  } catch {
    return 'unparseable DATABASE_URL';
  }
}

/** The extended client, including the soft-delete read filter. */
export type ExtendedPrismaClient = ReturnType<typeof createClient>;

/**
 * Owns the database connection. Deliberately **not** exported from `PersistenceModule`:
 * a service cannot inject it, so the only way to reach the database is through a
 * repository. That is the runtime half of decision #9; the ESLint import boundary is the
 * compile-time half.
 */
@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  readonly client: ExtendedPrismaClient;

  private readonly target: string;

  constructor(config: ConfigService<Env, true>) {
    const databaseUrl = config.get('DATABASE_URL', { infer: true });
    this.target = describeTarget(databaseUrl);
    this.client = createClient(databaseUrl);
  }

  async onModuleInit(): Promise<void> {
    await this.client.$connect();
    // Name the target explicitly. Pointing a local run at the production database is
    // silent and easy to do, and "connection established" alone does not distinguish it.
    this.logger.log(`Database connection established: ${this.target}`);
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.$disconnect();
  }
}
