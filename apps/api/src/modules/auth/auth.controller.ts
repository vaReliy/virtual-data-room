import { Controller, Get, HttpCode, HttpStatus, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthGuard } from '@nestjs/passport';
import type { Request, Response } from 'express';

import type { Env } from '../../config/env';
import { AuthService } from './auth.service';
import { SESSION_COOKIE, sessionCookieOptions } from './session';
import type { GoogleIdentity } from './user.repository';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /** Starts the OAuth dance. The guard redirects; this handler is never reached. */
  @Get('google')
  @UseGuards(AuthGuard('google'))
  startGoogleLogin(): void {
    // Intentionally empty.
  }

  /**
   * Google returns the user here. The session cookie is set on a redirect response, so
   * the browser lands on the SPA already authenticated — no token ever touches the URL
   * or the page's JavaScript.
   */
  @Get('google/callback')
  @UseGuards(AuthGuard('google'))
  async completeGoogleLogin(
    @Req() request: Request & { user?: GoogleIdentity },
    @Res() response: Response,
  ): Promise<void> {
    const appUrl = this.config.get('APP_URL', { infer: true });

    if (!request.user) {
      response.redirect(`${appUrl}/login?error=google`);
      return;
    }

    const user = await this.auth.completeGoogleLogin(request.user);
    const isProduction = this.config.get('NODE_ENV', { infer: true }) === 'production';

    response.cookie(
      SESSION_COOKIE,
      this.auth.issueSessionToken(user),
      sessionCookieOptions(isProduction),
    );
    response.redirect(appUrl);
  }

  /** Clearing the cookie is the whole of logout — the token is stateless by design. */
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  logout(@Res({ passthrough: true }) response: Response): void {
    const isProduction = this.config.get('NODE_ENV', { infer: true }) === 'production';
    const { maxAge: _maxAge, ...options } = sessionCookieOptions(isProduction);
    response.clearCookie(SESSION_COOKIE, options);
  }
}
