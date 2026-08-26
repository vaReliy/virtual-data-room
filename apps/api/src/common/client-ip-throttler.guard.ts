import { Injectable, Logger } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { Request } from 'express';

/**
 * The anonymous share surface's rate limit, keyed on the **client IP** — the one place in
 * this system where there is no session to key on, because possession of the token is the
 * whole authorization.
 *
 * `SessionThrottlerGuard` cannot be reused and is not a near miss: it keys on
 * `session.userId` and throws deliberately when there is none, because for presign a
 * missing session means a broken guard chain. Here a missing session is the normal case.
 *
 * **`req.ip` is only the caller's address if Express has been told to trust the forwarding
 * chain.** Behind the Vercel rewrite and Cloud Run it is otherwise the proxy's address for
 * every caller, which turns a per-IP bucket into one shared bucket for the whole
 * deployment — a limit that works, counts, and is wrong. `main.ts` sets `trust proxy` from
 * `TRUST_PROXY_HOPS`, and the log below is how that number is *observed* rather than
 * guessed: trusting more hops than actually sit in front of the service lets a caller spoof
 * `X-Forwarded-For` and walk past the limit; trusting fewer collapses every caller into one
 * bucket.
 */
@Injectable()
export class ClientIpThrottlerGuard extends ThrottlerGuard {
  private static readonly logger = new Logger(ClientIpThrottlerGuard.name);
  /** Once per process, not once per request: this is a deployment fact, not a trace. */
  private static reported = false;

  protected override getTracker(req: Record<string, unknown>): Promise<string> {
    const request = req as unknown as Request;
    const ip = request.ip ?? request.socket.remoteAddress ?? 'unknown';

    if (!ClientIpThrottlerGuard.reported) {
      ClientIpThrottlerGuard.reported = true;
      ClientIpThrottlerGuard.logger.log(
        `Anonymous share request. req.ip=${ip} ` +
          `req.ips=[${request.ips.join(', ')}] ` +
          `x-forwarded-for=${String(request.headers['x-forwarded-for'] ?? '(absent)')} ` +
          // The raw setting, not the compiled `trust proxy fn` Express derives from it —
          // that one is a function either way and would read as "enabled" at every value.
          `trust proxy=${String(request.app.get('trust proxy'))}`,
      );
    }

    // No throw and no fallback to a constant: unlike the presign guard, an unresolvable
    // address here is a caller state rather than a broken guard chain, and refusing to
    // serve a share because the socket had no address would be the wrong failure.
    return Promise.resolve(ip);
  }
}
