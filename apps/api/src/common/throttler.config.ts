import { minutes, type ThrottlerModuleOptions } from '@nestjs/throttler';

/** The name the guard and the `@Throttle` metadata agree on. One bucket, one meaning. */
export const PRESIGN_THROTTLER = 'presign';

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
export const presignThrottlerConfig: ThrottlerModuleOptions = [
  { name: PRESIGN_THROTTLER, limit: 20, ttl: minutes(1) },
];
