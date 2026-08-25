import type { CookieOptions } from 'express';

/** Name of the httpOnly cookie carrying the session JWT. */
export const SESSION_COOKIE = 'dr_session';

/** Two hours (decision #14). Short enough that no refresh token is needed. */
export const SESSION_TTL_SECONDS = 2 * 60 * 60;

/** Past half its life, an authenticated request silently gets a fresh token. */
export const SESSION_REISSUE_AFTER_SECONDS = SESSION_TTL_SECONDS / 2;

/** Claims carried by the session token. Nothing secret: it is signed, not encrypted. */
export interface SessionPayload {
  sub: string;
  email: string;
  iat?: number;
  exp?: number;
}

/** What the JWT strategy hands to controllers on an authenticated request. */
export interface SessionContext {
  userId: string;
  email: string;
  issuedAt: number | null;
}

/**
 * The SPA and `/api/*` share one origin (decision #10), so this cookie is first-party.
 * That is what makes `SameSite=Lax` sufficient and what makes it work in Safari, which
 * blocks third-party cookies outright.
 */
export function sessionCookieOptions(isProduction: boolean): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProduction,
    path: '/',
    maxAge: SESSION_TTL_SECONDS * 1000,
  };
}
