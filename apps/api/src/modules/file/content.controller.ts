import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import {
  contentDispositionQuerySchema,
  type ContentDisposition,
  type ContentUrlResponse,
} from '@dr/contracts';
import type { Request } from 'express';

import { AccessControlService } from '../../access/access-control.service';
import { ZodQueryPipe } from '../../common/zod-query.pipe';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { SessionContext } from '../auth/session';
import { ContentService } from './content.service';

type AuthenticatedRequest = Request & { user?: SessionContext };

/**
 * `GET /api/rooms/:roomId/nodes/:nodeId/content`.
 *
 * The URL sits under `nodes` — it is a property of a node — while the code lives in
 * `modules/file/`, because producing it needs the blob and the storage client and neither
 * belongs in the node module. Nest resolves it alongside `NodeController`'s `:nodeId`
 * without ambiguity: the paths differ in segment count.
 *
 * **No throttler and no `role` guard.** Reading is already answered by the `AccessScope`
 * boundary, and a `VIEWER` must be able to open — and save — a file shared with them in
 * Phase 4. `?disposition=attachment` is that save, and it changes nothing about who may
 * ask: the same bytes are already reachable from the preview.
 */
@Controller('rooms/:roomId/nodes')
@UseGuards(JwtAuthGuard)
export class ContentController {
  constructor(
    private readonly accessControl: AccessControlService,
    private readonly content: ContentService,
  ) {}

  @Get(':nodeId/content')
  async contentUrl(
    @Req() request: AuthenticatedRequest,
    @Param('roomId', ParseUUIDPipe) roomId: string,
    @Param('nodeId', ParseUUIDPipe) nodeId: string,
    // Absent means `inline`, applied by the schema's own default, so every caller written
    // before download existed is unaffected. An unknown value is a `400` rather than a
    // silent fallback: this parameter is assembled by our client, not typed by a reader.
    @Query('disposition', new ZodQueryPipe(contentDispositionQuerySchema))
    disposition: ContentDisposition,
  ): Promise<ContentUrlResponse> {
    if (!request.user) throw new UnauthorizedException();
    const scope = await this.accessControl.resolveForUser(request.user.userId, roomId);
    return this.content.urlFor(scope, nodeId, disposition);
  }
}
