import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  CreateShareBody,
  CreateShareResponse,
  ShareSummary,
  SharedWithMeEntry,
} from '@dr/contracts';

import type { AccessScope } from '../../access/access-scope';
import type { Env } from '../../config/env';
import { UserRepository } from '../auth/user.repository';
import { NodeRepository } from '../node/node.repository';
import { NodeService } from '../node/node.service';
import { createShareToken, hashShareToken } from './share-token';
import { ShareRepository, type GrantedShareRecord, type ShareRecord } from './share.repository';

@Injectable()
export class ShareService {
  constructor(
    private readonly shares: ShareRepository,
    private readonly nodes: NodeService,
    // Read directly, exactly as `AccessControlService` does — `findGrantNodeInRoom` is a
    // scope exception with no `AccessScope` to route through `NodeService`, and issue 09's
    // cascade needs the node beneath a grant before a scope for it exists.
    private readonly nodeRepository: NodeRepository,
    private readonly users: UserRepository,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /**
   * Creates a share on a node, or on the whole Data Room when `nodeId` is `null`.
   *
   * The order of the two checks is the error contract. `assertMayWrite` runs first, so a
   * non-owner learns nothing about which nodes exist; only then is the target resolved,
   * which makes sharing a deleted node a `410` and sharing one outside the scope a `404`
   * — the same two answers every other endpoint gives for the same two situations.
   *
   * The token is minted here and returned here, once. `shareSummarySchema` has no field to
   * carry it, which is what stops any later response leaking it.
   */
  async create(
    scope: AccessScope,
    body: CreateShareBody,
    createdById: string,
  ): Promise<CreateShareResponse> {
    this.nodes.assertMayWrite(scope);

    if (body.nodeId !== null) {
      await this.nodes.resolveLiveNode(scope, body.nodeId);
    }

    const token = body.mode === 'LINK' ? createShareToken() : null;

    const share = await this.shares.create(scope, {
      nodeId: body.nodeId,
      mode: body.mode,
      // `shares_mode_check` requires exactly one of these two on every row, which is why
      // they are set from the mode rather than copied from the body.
      tokenHash: token === null ? null : hashShareToken(token),
      granteeEmail: body.mode === 'USER' ? (body.granteeEmail ?? null) : null,
      expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
      createdById,
    });

    return {
      ...toSummary(share),
      url: token === null ? null : `${this.config.get('APP_URL', { infer: true })}/s/${token}`,
    };
  }

  /**
   * The live shares on one node, or on the room itself when `nodeId` is `null`.
   *
   * Owner-only, through the same guard the mutations use: who a document has been shared
   * with is as sensitive as the document. A `VIEWER` therefore gets `404` rather than an
   * empty list, because an empty list is an answer and this caller is owed none.
   */
  async listForNode(scope: AccessScope, nodeId: string | null): Promise<ShareSummary[]> {
    this.nodes.assertMayWrite(scope);

    // No node resolution: the query is bounded by `scope.dataRoomId`, so a node id from
    // another room selects nothing — the same answer as a node that never existed.
    const shares = await this.shares.listLiveForNode(scope, nodeId);
    return Promise.all(shares.map((share) => this.toListSummary(scope.dataRoomId, share)));
  }

  /**
   * `toSummary` plus `nestedLiveGrantCount` (issue 09) — the number of other live `USER`
   * grants the same grantee holds strictly beneath this one, so the row-menu revoke can
   * offer a cascade before the caller clicks it rather than after.
   *
   * Only a `USER` grant can have anything nested under it; a `LINK` share has no grantee
   * to group by. A `FILE` grant's subtree test always returns zero (a file has nothing
   * beneath it), so it is not special-cased — the extra lookup is cheap and the code stays
   * one path instead of two.
   */
  private async toListSummary(dataRoomId: string, share: ShareRecord): Promise<ShareSummary> {
    if (share.mode !== 'USER' || !share.granteeEmail) return toSummary(share);

    const path = await this.grantPath(dataRoomId, share.nodeId);
    if (path === null) return toSummary(share);

    const nested = await this.nestedLiveGrantShareIds(dataRoomId, share.granteeEmail, path);
    return { ...toSummary(share), nestedLiveGrantCount: nested.length };
  }

  /**
   * Revokes a share. `404` when the id belongs to another room or to nothing at all — a
   * share id is not a secret, but which room it belongs to is.
   *
   * Revoking an already-revoked share succeeds and changes nothing: the repository's
   * `where` keeps the original `revoked_at`, so the record of when access ended survives a
   * double click.
   *
   * `cascade` (issue 09) additionally revokes every other live `USER` grant the same
   * grantee holds strictly beneath this one's node — see `cascadeTargets`. It is silently
   * a no-op for anything the roadmap's plain revoke already covers on its own: a `LINK`
   * share, a `FILE` grant, or a share that was already revoked.
   */
  async revoke(scope: AccessScope, shareId: string, cascade: boolean): Promise<void> {
    this.nodes.assertMayWrite(scope);

    const share = await this.shares.findInScope(scope, shareId);
    if (!share) throw new NotFoundException('Share not found.');

    const targets = await this.cascadeTargets(scope.dataRoomId, share, cascade);
    if (targets.length === 1) {
      await this.shares.revoke(scope, share.id);
    } else {
      await this.shares.revokeMany(scope, targets);
    }
  }

  /**
   * The share ids a revoke touches: just `share.id`, unless cascading applies and finds
   * something beneath it. Shared by `revoke` and the list's `nestedLiveGrantCount` — one
   * definition of "nested", so the number the dialog shows and what a cascade actually
   * revokes never disagree.
   */
  private async cascadeTargets(
    dataRoomId: string,
    share: ShareRecord,
    cascade: boolean,
  ): Promise<string[]> {
    if (!cascade || share.mode !== 'USER' || share.revokedAt !== null || !share.granteeEmail) {
      return [share.id];
    }

    const path = await this.grantPath(dataRoomId, share.nodeId);
    if (path === null) return [share.id];

    const nested = await this.nestedLiveGrantShareIds(dataRoomId, share.granteeEmail, path);
    return [share.id, ...nested];
  }

  /**
   * The `path` a grant's node covers — `'/'` for a whole-room grant, the node's own `path`
   * otherwise. `null` when the node cannot be resolved in this room, which the caller
   * treats as "nothing to compute", the same way a dangling grant is dropped elsewhere.
   */
  private async grantPath(dataRoomId: string, nodeId: string | null): Promise<string | null> {
    if (nodeId === null) return '/';
    const node = await this.nodeRepository.findGrantNodeInRoom(dataRoomId, nodeId);
    return node?.path ?? null;
  }

  /**
   * Every other live `USER` grant `email` holds in `dataRoomId` whose node lies strictly
   * beneath `path` — the trailing slash every `path` ends with is what makes `startsWith`
   * a subtree test rather than a name-prefix test (`/Legal/` does not match `/Legal Archive/`).
   *
   * `findGrantNodeInRoom` is raw SQL and bypasses the soft-delete extension on purpose —
   * that is what lets a deleted grant node answer `410` elsewhere — so a resolved node
   * with `deletedAt` set is dropped here explicitly: it is a live *share row* pointing at
   * something that no longer exists, and counting it would offer to revoke a grant that
   * already serves nothing.
   */
  private async nestedLiveGrantShareIds(
    dataRoomId: string,
    email: string,
    path: string,
  ): Promise<string[]> {
    const grants = await this.shares.findLiveGrantsForEmail(dataRoomId, email);
    const nested = await Promise.all(
      grants.map(async (grant) => {
        // A whole-room grant has no node to compare a path against, and nothing nests
        // "beneath" it in this sense — it is the same scope, not a wider one.
        if (grant.nodeId === null) return null;
        const node = await this.nodeRepository.findGrantNodeInRoom(dataRoomId, grant.nodeId);
        if (!node || node.deletedAt !== null) return null;
        if (node.path === path || !node.path.startsWith(path)) return null;
        return grant.id;
      }),
    );
    return nested.filter((id): id is string => id !== null);
  }

  /**
   * "Shared with me": every live `USER` grant held by the caller, across rooms.
   *
   * **Matched on the caller's *verified* email only** (decision #7). The session token
   * carries `{ sub, email }` and no verification flag, so the flag is read from the user
   * row; an unverified address matches nothing, exactly as it resolves to nothing in
   * `AccessControlService`. Without that rule, registering an account on somebody else's
   * address would list — and then open — what was shared with them.
   *
   * Each row names the **granted node**, never the room, unless the grant is on the whole
   * room and the room therefore *is* the grantee's scope. A room name sitting beside a
   * subtree grant would leak precisely what breadcrumb clipping protects.
   */
  async sharedWithMe(userId: string): Promise<SharedWithMeEntry[]> {
    const user = await this.users.findById(userId);
    if (!user?.emailVerified) return [];

    const grants = await this.shares.listForGrantee(user.email);
    return grants.map((grant) => toSharedWithMeEntry(grant));
  }
}

/** The wire shape of a share. No token, and no `tokenHash` — neither has a field here. */
function toSummary(share: ShareRecord): ShareSummary {
  return {
    id: share.id,
    nodeId: share.nodeId,
    mode: share.mode,
    role: share.role,
    granteeEmail: share.granteeEmail,
    expiresAt: share.expiresAt?.toISOString() ?? null,
    createdAt: share.createdAt.toISOString(),
  };
}

function toSharedWithMeEntry(grant: GrantedShareRecord): SharedWithMeEntry {
  return {
    id: grant.id,
    dataRoomId: grant.dataRoomId,
    nodeId: grant.nodeId,
    // The room's name travels only with a whole-room grant, where it is the name of the
    // grantee's own scope root. Anywhere else it sits above the scope and is confidential.
    name: grant.node?.name ?? grant.dataRoom.name,
    type: grant.node?.type ?? 'ROOM',
    sharedBy: { name: grant.createdBy.name, email: grant.createdBy.email },
    createdAt: grant.createdAt.toISOString(),
  };
}
