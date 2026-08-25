/**
 * One place where cache keys are spelled, so an invalidation and the query it is meant
 * to invalidate cannot drift apart. Decision #13 puts the whole browser view behind a
 * single endpoint, so the key set stays small on purpose.
 */
export const queryKeys = {
  /** `GET /api/me` — the session subject and the Data Rooms they own. */
  session: ['session'] as const,
} as const;
