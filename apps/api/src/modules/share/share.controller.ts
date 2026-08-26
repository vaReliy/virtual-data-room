import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import {
  cascadeQuerySchema,
  createShareBodySchema,
  uuidSchema,
  type CreateShareBody,
  type CreateShareResponse,
  type ShareSummary,
  type SharedWithMeEntry,
} from '@dr/contracts';
import type { Request } from 'express';

import { AccessControlService } from '../../access/access-control.service';
import { ZodQueryPipe } from '../../common/zod-query.pipe';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { SessionContext } from '../auth/session';
import { ShareService } from './share.service';

type AuthenticatedRequest = Request & { user?: SessionContext };

/** The guard has already run; this narrows its result rather than re-authenticating. */
function sessionOf(request: AuthenticatedRequest): SessionContext {
  if (!request.user) throw new UnauthorizedException();
  return request.user;
}

/**
 * Shares of one Data Room. Every route resolves an `AccessScope` before it does anything
 * else and passes it down explicitly, exactly as the node endpoints do — the scope is
 * never parked on the request where a later handler could read a stale one.
 *
 * All three are owner-only, and the guard is `NodeService.assertMayWrite` inside the
 * service rather than a decorator here: a decorator would have to read the scope off
 * ambient request state, and scopes are passed explicitly so they cannot be forged or
 * forgotten (decision #25). It answers `404`, never `403`.
 */
@Controller('rooms/:roomId/shares')
@UseGuards(JwtAuthGuard)
export class ShareController {
  constructor(
    private readonly accessControl: AccessControlService,
    private readonly shares: ShareService,
  ) {}

  @Post()
  async create(
    @Req() request: AuthenticatedRequest,
    @Param('roomId', ParseUUIDPipe) roomId: string,
    @Body(new ZodValidationPipe(createShareBodySchema)) body: CreateShareBody,
  ): Promise<CreateShareResponse> {
    const session = sessionOf(request);
    const scope = await this.accessControl.resolveForUser(session.userId, roomId);
    return this.shares.create(scope, body, session.userId);
  }

  /**
   * `?nodeId=` absent means the shares on the room itself — the same `null` the column
   * carries — rather than "all shares in the room". The dialog always asks about one
   * target, and a listing that spanned the room would be a different screen.
   */
  @Get()
  async list(
    @Req() request: AuthenticatedRequest,
    @Param('roomId', ParseUUIDPipe) roomId: string,
    @Query('nodeId', new ZodQueryPipe(uuidSchema.optional())) nodeId?: string,
  ): Promise<ShareSummary[]> {
    const scope = await this.accessControl.resolveForUser(sessionOf(request).userId, roomId);
    return this.shares.listForNode(scope, nodeId ?? null);
  }

  /**
   * `?cascade=true` (issue 09) also revokes every other live `USER` grant the same
   * grantee holds strictly beneath this share's node. Default `false`, so a caller that
   * does not know about the feature does not cascade.
   */
  @Delete(':shareId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revoke(
    @Req() request: AuthenticatedRequest,
    @Param('roomId', ParseUUIDPipe) roomId: string,
    @Param('shareId', ParseUUIDPipe) shareId: string,
    @Query('cascade', new ZodQueryPipe(cascadeQuerySchema)) cascade: boolean,
  ): Promise<void> {
    const scope = await this.accessControl.resolveForUser(sessionOf(request).userId, roomId);
    await this.shares.revoke(scope, shareId, cascade);
  }
}

/**
 * "Shared with me" is deliberately **not** under a room: it spans rooms by definition, and
 * the caller has no scope in any of them until they open one. There is nothing here for an
 * `AccessScope` to bound — the verified session email is the boundary.
 *
 * The rooms it names are not added to `MeResponse.dataRooms`: that array is what the
 * client reads as "provisioning failed" when it is empty, and decision #23 ships no room
 * switcher. A grantee sees their own room, plus this list.
 */
@Controller('shares')
@UseGuards(JwtAuthGuard)
export class SharedWithMeController {
  constructor(private readonly shares: ShareService) {}

  @Get('shared-with-me')
  async sharedWithMe(@Req() request: AuthenticatedRequest): Promise<SharedWithMeEntry[]> {
    return this.shares.sharedWithMe(sessionOf(request).userId);
  }
}
