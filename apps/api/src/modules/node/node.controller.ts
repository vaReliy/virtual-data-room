import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import {
  createFolderBodySchema,
  moveNodeBodySchema,
  renameNodeBodySchema,
  type BrowseResponse,
  type CreateFolderBody,
  type MoveNodeBody,
  type NodeSummary,
  type RenameNodeBody,
} from '@dr/contracts';
import type { Request } from 'express';

import { AccessControlService } from '../../access/access-control.service';
import type { AccessScope } from '../../access/access-scope';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { SessionContext } from '../auth/session';
import { NodeService } from './node.service';

type AuthenticatedRequest = Request & { user?: SessionContext };

/**
 * The four node endpoints (decision #24, `architecture.md` § Node endpoints). All of them
 * sit behind the session guard, and **each one resolves an `AccessScope` before it does
 * anything else** — the scope is then passed explicitly down, never parked on the request
 * where a later handler could read a stale one or forget to ask for one at all.
 *
 * Move (`POST /:nodeId/move`) is specified alongside these and arrives in Phase 3, when
 * there is a file to move.
 */
@Controller('rooms/:roomId/nodes')
@UseGuards(JwtAuthGuard)
export class NodeController {
  constructor(
    private readonly accessControl: AccessControlService,
    private readonly nodes: NodeService,
  ) {}

  /** The room root: no node to describe, and nowhere further up. */
  @Get()
  async browseRoot(
    @Req() request: AuthenticatedRequest,
    @Param('roomId', ParseUUIDPipe) roomId: string,
    @Query('cursor') cursor?: string,
  ): Promise<BrowseResponse> {
    const scope = await this.scopeFor(request, roomId);
    return this.nodes.browse(scope, undefined, cursor);
  }

  @Get(':nodeId')
  async browse(
    @Req() request: AuthenticatedRequest,
    @Param('roomId', ParseUUIDPipe) roomId: string,
    @Param('nodeId', ParseUUIDPipe) nodeId: string,
    @Query('cursor') cursor?: string,
  ): Promise<BrowseResponse> {
    const scope = await this.scopeFor(request, roomId);
    return this.nodes.browse(scope, nodeId, cursor);
  }

  @Post()
  async createFolder(
    @Req() request: AuthenticatedRequest,
    @Param('roomId', ParseUUIDPipe) roomId: string,
    @Body(new ZodValidationPipe(createFolderBodySchema)) body: CreateFolderBody,
  ): Promise<NodeSummary> {
    const session = this.sessionOf(request);
    const scope = await this.accessControl.resolveForUser(session.userId, roomId);
    return this.nodes.createFolder(scope, body, session.userId);
  }

  @Patch(':nodeId')
  async rename(
    @Req() request: AuthenticatedRequest,
    @Param('roomId', ParseUUIDPipe) roomId: string,
    @Param('nodeId', ParseUUIDPipe) nodeId: string,
    @Body(new ZodValidationPipe(renameNodeBodySchema)) body: RenameNodeBody,
  ): Promise<NodeSummary> {
    const scope = await this.scopeFor(request, roomId);
    return this.nodes.rename(scope, nodeId, body.name);
  }

  /**
   * A dedicated sub-resource rather than a field on `PATCH`: folding `parentId` into the
   * rename body makes `{ "parentId": null }` — move to the room root — indistinguishable
   * from a `parentId` the client did not send.
   *
   * Type-agnostic, because the repository method is shared. `BRIEF.md` only requires moving
   * a file and no phase builds a folder-move UI, so the cycle guard is covered by a test
   * rather than by a screen.
   */
  @Post(':nodeId/move')
  @HttpCode(HttpStatus.OK)
  async move(
    @Req() request: AuthenticatedRequest,
    @Param('roomId', ParseUUIDPipe) roomId: string,
    @Param('nodeId', ParseUUIDPipe) nodeId: string,
    @Body(new ZodValidationPipe(moveNodeBodySchema)) body: MoveNodeBody,
  ): Promise<NodeSummary> {
    const scope = await this.scopeFor(request, roomId);
    return this.nodes.move(scope, nodeId, body);
  }

  /**
   * `204`, with nothing in the body. The delete-warning dialog was rendered before this
   * call from the folder's own aggregates, so the response has nothing left to say that a
   * cache invalidation does not.
   */
  @Delete(':nodeId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteSubtree(
    @Req() request: AuthenticatedRequest,
    @Param('roomId', ParseUUIDPipe) roomId: string,
    @Param('nodeId', ParseUUIDPipe) nodeId: string,
  ): Promise<void> {
    const scope = await this.scopeFor(request, roomId);
    await this.nodes.deleteSubtree(scope, nodeId);
  }

  private async scopeFor(request: AuthenticatedRequest, roomId: string): Promise<AccessScope> {
    return this.accessControl.resolveForUser(this.sessionOf(request).userId, roomId);
  }

  /** The guard has already run; this narrows its result rather than re-authenticating. */
  private sessionOf(request: AuthenticatedRequest): SessionContext {
    if (!request.user) throw new UnauthorizedException();
    return request.user;
  }
}
