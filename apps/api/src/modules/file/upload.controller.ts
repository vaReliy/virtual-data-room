import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import {
  completeUploadBodySchema,
  presignUploadBodySchema,
  type CompleteUploadBody,
  type NodeSummary,
  type PresignUploadBody,
  type PresignUploadResponse,
} from '@dr/contracts';
import type { Request, Response } from 'express';

import { AccessControlService } from '../../access/access-control.service';
import { SessionThrottlerGuard } from '../../common/session-throttler.guard';
import { PRESIGN_THROTTLER, PUBLIC_SHARE_THROTTLER } from '../../common/throttler.config';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { SessionContext } from '../auth/session';
import { UploadService } from './upload.service';

type AuthenticatedRequest = Request & { user?: SessionContext };

/**
 * The upload protocol's own URL space, under the room (decision #28).
 *
 * **The guard order is the security property, not a style choice.** NestJS runs guards
 * global → controller → route and left to right inside one decorator, so `JwtAuthGuard`
 * must be named first: it is what populates `req.user` for `SessionThrottlerGuard` to key
 * on. Registering the throttler globally as an `APP_GUARD` would run it *before* any
 * authentication and give every caller the same tracker.
 *
 * The controller-wide `@SkipThrottle` is the other half of that property. One options array
 * holds every named bucket in this application (`throttler.config.ts` says why it has to),
 * and a `ThrottlerGuard` enforces **all** of them — so without this line presign would also
 * count against the anonymous share bucket, spending a limit that exists to bound requests
 * from callers with no account at all.
 */
@Controller('rooms/:roomId/uploads')
@UseGuards(JwtAuthGuard, SessionThrottlerGuard)
@SkipThrottle({ [PUBLIC_SHARE_THROTTLER]: true })
export class UploadController {
  constructor(
    private readonly accessControl: AccessControlService,
    private readonly uploads: UploadService,
  ) {}

  /**
   * A batch of presigned `PUT`s. Rate-limited to twenty calls a minute **per session user**
   * — with ten files each, two hundred files a minute, which no person dragging documents
   * into a browser reaches. That is why `429` is a plain per-file error row rather than a
   * retry-with-backoff path.
   */
  @Post('presign')
  async presign(
    @Req() request: AuthenticatedRequest,
    @Param('roomId', ParseUUIDPipe) roomId: string,
    @Body(new ZodValidationPipe(presignUploadBodySchema)) body: PresignUploadBody,
  ): Promise<PresignUploadResponse> {
    const scope = await this.scopeFor(request, roomId);
    return this.uploads.presign(scope, body);
  }

  /**
   * One completed file. `201` when this call created the node, `200` when it did not —
   * a repeated complete over a lost response is answered rather than refused, and the two
   * codes say which happened. Both are success; a client that treats every 2xx alike is
   * correct.
   *
   * **Explicitly skipped** by the throttler. The guard is registered on the controller, so
   * without this it would apply the presign bucket here too — and a per-file call throttled
   * at the presign rate would refuse the tail of a batch that the same limit had just
   * allowed. Complete mints no URLs, so there is nothing here for the limit to protect.
   */
  @Post('complete')
  @SkipThrottle({ [PRESIGN_THROTTLER]: true })
  @HttpCode(HttpStatus.CREATED)
  async complete(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
    @Param('roomId', ParseUUIDPipe) roomId: string,
    @Body(new ZodValidationPipe(completeUploadBodySchema)) body: CompleteUploadBody,
  ): Promise<NodeSummary> {
    const session = this.sessionOf(request);
    const scope = await this.accessControl.resolveForUser(session.userId, roomId);

    const { node, created } = await this.uploads.complete(scope, body, session.userId);
    if (!created) response.status(HttpStatus.OK);
    return node;
  }

  private async scopeFor(request: AuthenticatedRequest, roomId: string) {
    return this.accessControl.resolveForUser(this.sessionOf(request).userId, roomId);
  }

  /** The guard has already run; this narrows its result rather than re-authenticating. */
  private sessionOf(request: AuthenticatedRequest): SessionContext {
    if (!request.user) throw new UnauthorizedException();
    return request.user;
  }
}
