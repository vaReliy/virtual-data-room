import { Controller, Get, Req, UnauthorizedException, UseGuards } from '@nestjs/common';
import type { MeResponse } from '@dr/contracts';
import type { Request } from 'express';

import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import type { SessionContext } from './session';

@Controller()
export class MeController {
  constructor(private readonly auth: AuthService) {}

  /**
   * Who is signed in, and which Data Rooms they own. Lives at `/api/me` rather than
   * under `/api/auth` because it describes the session's subject, not the login flow.
   */
  @Get('me')
  @UseGuards(JwtAuthGuard)
  async me(@Req() request: Request & { user?: SessionContext }): Promise<MeResponse> {
    const session = request.user;
    if (!session) throw new UnauthorizedException();

    const described = await this.auth.describeSession(session.userId);
    // A valid token whose user has since disappeared: the session is no longer real.
    if (!described) throw new UnauthorizedException();

    return described;
  }
}
