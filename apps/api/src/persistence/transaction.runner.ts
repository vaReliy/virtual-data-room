import { Injectable } from '@nestjs/common';

import { PrismaService, type TransactionClient } from './prisma.service';

/**
 * The Prisma interactive-transaction budget for this API.
 *
 * The defaults are `maxWait` 2 s / `timeout` 5 s, and neither fits upload-complete:
 * `pg_advisory_xact_lock` on the Data Room is taken **inside** the transaction, so time
 * spent queueing behind another upload into the same room counts against `timeout`, not
 * against `maxWait`. The auto-suffix retry re-runs the whole transaction up to three times
 * on top of that.
 *
 * 15 s is the smallest number that leaves room for the lock wait plus those retries while
 * still being short enough that a genuine deadlock surfaces as a failure rather than as a
 * hung request.
 */
export const TRANSACTION_MAX_WAIT_MS = 5_000;
export const TRANSACTION_TIMEOUT_MS = 15_000;

/**
 * Opens an interactive transaction for a caller that spans more than one repository.
 *
 * It exists because upload-complete does: the advisory lock, the authoritative quota check,
 * the conditional `PENDING → READY` flip on `Blob` and the `Node` insert are one atomic
 * step across two repositories, so the transaction belongs to neither of them. Every
 * single-repository transaction — `createFolder`, `deleteSubtree`, `move` — still opens its
 * own and does not come through here.
 *
 * It lives in the persistence layer rather than in a module for the same reason
 * `PrismaService` does: this is the only place allowed to name the client. What it hands
 * out is a `TransactionClient` to pass **explicitly** into repository methods, never
 * ambient state — a transaction parked on a request or in an async-local store is a
 * transaction someone forgets to pass and silently runs outside of.
 */
@Injectable()
export class TransactionRunner {
  constructor(private readonly prisma: PrismaService) {}

  async run<T>(work: (tx: TransactionClient) => Promise<T>): Promise<T> {
    return this.prisma.client.$transaction(work, {
      maxWait: TRANSACTION_MAX_WAIT_MS,
      timeout: TRANSACTION_TIMEOUT_MS,
    });
  }
}
