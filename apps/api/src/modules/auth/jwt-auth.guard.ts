import { Injectable, type ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AuthGuard } from '@nestjs/passport';
import type { Request, Response } from 'express';

import type { Env } from '../../config/env';
import {
  SESSION_COOKIE,
  SESSION_REISSUE_AFTER_SECONDS,
  SESSION_TTL_SECONDS,
  sessionCookieOptions,
  type SessionContext,
} from './session';

/**
 * Authenticates the session cookie and, past half the token's life, quietly replaces it.
 *
 * The sliding window is what makes a 2-hour token with no refresh token workable
 * (decision #14): someone actively using the app is never logged out mid-task, while an
 * abandoned session still dies within two hours.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService<Env, true>,
  ) {
    super();
  }

  override async canActivate(context: ExecutionContext): Promise<boolean> {
    const authenticated = (await super.canActivate(context)) as boolean;
    if (!authenticated) return false;

    const http = context.switchToHttp();
    const session = http.getRequest<Request & { user?: SessionContext }>().user;
    if (session) this.reissueIfStale(session, http.getResponse<Response>());

    return true;
  }

  private reissueIfStale(session: SessionContext, response: Response): void {
    if (session.issuedAt === null) return;

    const ageSeconds = Math.floor(Date.now() / 1000) - session.issuedAt;
    if (ageSeconds < SESSION_REISSUE_AFTER_SECONDS) return;

    const token = this.jwt.sign(
      { sub: session.userId, email: session.email },
      { expiresIn: SESSION_TTL_SECONDS },
    );
    const isProduction = this.config.get('NODE_ENV', { infer: true }) === 'production';
    response.cookie(SESSION_COOKIE, token, sessionCookieOptions(isProduction));
  }
}
