import { Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import {
  contentDispositionQuerySchema,
  type BrowseResponse,
  type ContentDisposition,
  type ContentUrlResponse,
} from '@dr/contracts';

import { AccessControlService } from '../../access/access-control.service';
import { ClientIpThrottlerGuard } from '../../common/client-ip-throttler.guard';
import { PRESIGN_THROTTLER } from '../../common/throttler.config';
import { ZodQueryPipe } from '../../common/zod-query.pipe';
import { ContentService } from '../file/content.service';
import { NodeService } from '../node/node.service';

/**
 * The share link's own surface: `GET /api/s/:token`, and everything reachable below it.
 *
 * **There is no session here** — no cookie, no `JwtAuthGuard`, and therefore none of the
 * protections every other controller in this codebase inherits without asking. The
 * authorization is the token itself: possession of the preimage of a `token_hash` on a live
 * `LINK` share. Everything the handlers do beyond that is bounded by the `AccessScope`
 * `resolveForToken` produced, exactly as the authenticated routes are bounded by the one
 * `resolveForUser` produces.
 *
 * **It is read-only structurally, not by discipline.** The scope's `role` is `VIEWER`, and
 * the first statement of every mutation is `NodeService.assertMayWrite`, which throws `404`
 * for anything but an `OWNER` (`node.service.ts:231-233`). There are no write endpoints
 * here and adding one would not become writable by being added.
 *
 * **No second listing path.** The handlers hand the scope to the *existing* services and
 * return `browseResponseSchema` verbatim: that shape already describes what a
 * subtree-scoped caller sees — `room` omitted unless the scope is the whole room,
 * `parentId` nulled at the scope root, breadcrumbs clipped by arithmetic on `path`. A
 * public twin of the DTO is how the two drift, and it would also mean implementing Phase
 * 4.1's `?sort=` twice.
 *
 * `@SkipThrottle` on the presign bucket is load-bearing: one options array carries both
 * named buckets (see `throttler.config.ts`), a `ThrottlerGuard` enforces every bucket in
 * it, and without this an anonymous visitor would spend the upload allowance.
 *
 * It lives in `modules/public/` rather than beside the share endpoints it serves, because
 * what makes it different from every other controller is not its subject but its **guard
 * chain**: it has none. Keeping the sessionless surface in one directory is what lets a
 * reviewer answer "what is reachable with no account?" without reading decorators.
 */
@Controller('s/:token')
@UseGuards(ClientIpThrottlerGuard)
@SkipThrottle({ [PRESIGN_THROTTLER]: true })
export class PublicShareController {
  constructor(
    private readonly accessControl: AccessControlService,
    private readonly nodes: NodeService,
    private readonly content: ContentService,
  ) {}

  /**
   * The share root. `nodeId` is absent, so `NodeService.browse` answers with `node: null`
   * and an empty breadcrumb trail — "the caller's scope root", which for a link is the
   * shared node itself.
   *
   * **Unknown, revoked and expired tokens are one answer, `410`**, raised inside
   * `resolveForToken`. Separating "never existed" from "revoked" would distinguish real
   * links from invented ones and tells the reader nothing they can act on.
   */
  @Get()
  async browseRoot(
    @Param('token') token: string,
    @Query('cursor') cursor?: string,
  ): Promise<BrowseResponse> {
    const scope = await this.accessControl.resolveForToken(token);
    return this.nodes.browse(scope, undefined, cursor);
  }

  /**
   * A node inside the share. The id is not trusted for anything: `browse` runs every
   * request through the same scope-bounded statements, so an id outside the token's
   * subtree is a `404` and is indistinguishable from one that was never created.
   */
  @Get('n/:nodeId')
  async browse(
    @Param('token') token: string,
    @Param('nodeId', ParseUUIDPipe) nodeId: string,
    @Query('cursor') cursor?: string,
  ): Promise<BrowseResponse> {
    const scope = await this.accessControl.resolveForToken(token);
    return this.nodes.browse(scope, nodeId, cursor);
  }

  /**
   * The presigned GET behind the preview, and — with `?disposition=attachment` — behind
   * the download.
   *
   * **Download works here deliberately.** `ContentController` is not role-guarded
   * (`content.controller.ts:34-38`) and the same reasoning applies through a token: the
   * preview already serves the same bytes, so refusing to sign them `attachment` would be
   * theatre rather than a control.
   */
  @Get('n/:nodeId/content')
  async contentUrl(
    @Param('token') token: string,
    @Param('nodeId', ParseUUIDPipe) nodeId: string,
    @Query('disposition', new ZodQueryPipe(contentDispositionQuerySchema))
    disposition: ContentDisposition,
  ): Promise<ContentUrlResponse> {
    const scope = await this.accessControl.resolveForToken(token);
    return this.content.urlFor(scope, nodeId, disposition);
  }
}
