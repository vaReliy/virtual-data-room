import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import type { Request } from 'express';
import { ExtractJwt, Strategy } from 'passport-jwt';

import type { Env } from '../../config/env';
import { SESSION_COOKIE, type SessionContext, type SessionPayload } from './session';

/**
 * The token travels in an httpOnly cookie, never in a header: JavaScript in the page
 * cannot read it, so an XSS bug cannot exfiltrate the session.
 */
function extractFromSessionCookie(request: Request): string | null {
  const cookies = request.cookies as Record<string, string | undefined> | undefined;
  return cookies?.[SESSION_COOKIE] ?? null;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(config: ConfigService<Env, true>) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([extractFromSessionCookie]),
      secretOrKey: config.get('SESSION_SECRET', { infer: true }),
      ignoreExpiration: false,
    });
  }

  /**
   * Returns the claims rather than loading the user. A database read per request buys
   * nothing here: the token is short-lived, and every endpoint that needs the user's
   * row fetches it anyway.
   *
   * `issuedAt` is carried through so the guard can decide whether to re-issue.
   */
  validate(payload: SessionPayload): SessionContext {
    return {
      userId: payload.sub,
      email: payload.email,
      issuedAt: payload.iat ?? null,
    };
  }
}
