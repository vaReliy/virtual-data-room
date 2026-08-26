import { minutes, type ThrottlerModuleOptions } from '@nestjs/throttler';

/** The name the guard and the `@Throttle` metadata agree on. One bucket, one meaning. */
export const PRESIGN_THROTTLER = 'presign';

/** The anonymous share surface's bucket, keyed on the client IP rather than on a user. */
export const PUBLIC_SHARE_THROTTLER = 'public-share';

/**
 * Twenty presign requests per minute per user.
 *
 * A presign request carries up to ten files, so the ceiling is two hundred files a minute —
 * far beyond anything a person dragging documents into a browser reaches. That headroom is
 * why `429` is a plain per-file error row in the upload queue rather than a
 * retry-with-backoff path: a legitimate user does not see it.
 *
 * The limit exists because GCS's S3-compatible API supports presigned `PUT` but not POST
 * policy documents, so nothing at the storage layer bounds how many URLs one caller can
 * mint. It is one of three compensating controls, beside the quota check and the `HEAD`
 * verification at complete.
 *
 * `ttl` is in **milliseconds**; `minutes()` is the library's own helper for saying so.
 */
/**
 * **One options array holding both buckets, and that is forced rather than chosen.**
 *
 * `ThrottlerModule` is `@Global()` and `forRoot` provides `THROTTLER_OPTIONS`, so a second
 * `forRoot` in another module does not give that module private options — it registers a
 * second provider for the same global token, and whichever is resolved last decides what
 * *both* guards enforce. `throttler.config.test.ts` is that experiment, kept as a test
 * rather than reported as a conclusion.
 *
 * The cost of one array is that a `ThrottlerGuard` enforces **every** named bucket in it,
 * not merely the one its tracker was written for. Each controller therefore skips the
 * bucket that is not its own, and neither of those `@SkipThrottle`s is decoration:
 *
 * - without it on `UploadController`, `SessionThrottlerGuard` would count presign calls
 *   against the share bucket too;
 * - without it on `PublicShareController`, an anonymous visitor would be counted against
 *   the presign bucket by a guard whose tracker is the client IP — one leaked link would
 *   then spend a limit that exists to bound minting upload URLs.
 */
export const throttlerConfig: ThrottlerModuleOptions = [
  { name: PRESIGN_THROTTLER, limit: 20, ttl: minutes(1) },

  /**
   * Thirty requests a minute per client IP on `/s/:token`.
   *
   * **What it bounds is unauthenticated database load**, and saying more than that would
   * misrepresent it. It is not protection against token guessing — `randomBytes(32)` is
   * 256 bits, and guessing is infeasible with or without a limit. It is not protection
   * against a flood, because the library's default storage is in-process: on an
   * autoscaling Cloud Run service this limit is per-instance and approximate. What it
   * does stop is one script on one leaked link running a hash plus two Neon queries
   * without bound, from a caller who has no account and no other ceiling.
   *
   * Thirty is generous for a reader: opening a shared folder is one call, and each file
   * they open is one more.
   */
  { name: PUBLIC_SHARE_THROTTLER, limit: 30, ttl: minutes(1) },
];
