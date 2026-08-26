import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

import type { SessionContext } from '../modules/auth/session';

/**
 * The presign rate limit, keyed on the **session user** rather than on the IP address.
 *
 * Three things about this fail silently, and each one produces a limit that works, counts,
 * and is wrong:
 *
 * 1. **It must be registered on the controller, not as an `APP_GUARD`.** NestJS runs guards
 *    global → controller → route, so a global throttler executes *before* the controller's
 *    `JwtAuthGuard` and finds `req.user` undefined. The controller spells the order out:
 *    `@UseGuards(JwtAuthGuard, SessionThrottlerGuard)`.
 * 2. **The claim is `userId`.** `SessionContext` is `{ userId, email, issuedAt }` — it has
 *    no `id`, so the `req.user?.id` spelling from the library's own documentation compiles
 *    here and yields `undefined`, which every caller then shares as one tracker key.
 * 3. **There is no `req.ip` fallback, deliberately.** Behind the Vercel rewrite `req.ip` is
 *    the proxy's address for every caller, so a fallback would turn a broken guard chain
 *    into a single shared bucket for the whole deployment. This route sits behind the
 *    session guard, so a missing user is impossible unless something upstream is broken —
 *    and it should be loud rather than degraded.
 */
@Injectable()
export class SessionThrottlerGuard extends ThrottlerGuard {
  protected override getTracker(req: Record<string, unknown>): Promise<string> {
    const session = req.user as SessionContext | undefined;

    if (!session?.userId) {
      // A 500, and correctly so: the only way to reach this is with the session guard
      // missing or ordered after this one, and both are deployment bugs rather than
      // anything a caller did.
      throw new Error(
        'SessionThrottlerGuard ran without an authenticated session. It must be registered ' +
          'on the controller after JwtAuthGuard, never as a global APP_GUARD.',
      );
    }

    return Promise.resolve(session.userId);
  }
}
