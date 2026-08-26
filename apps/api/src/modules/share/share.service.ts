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
import { NodeService } from '../node/node.service';
import { createShareToken, hashShareToken } from './share-token';
import { ShareRepository, type GrantedShareRecord, type ShareRecord } from './share.repository';

@Injectable()
export class ShareService {
  constructor(
    private readonly shares: ShareRepository,
    private readonly nodes: NodeService,
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
    return shares.map(toSummary);
  }

  /**
   * Revokes a share. `404` when the id belongs to another room or to nothing at all — a
   * share id is not a secret, but which room it belongs to is.
   *
   * Revoking an already-revoked share succeeds and changes nothing: the repository's
   * `where` keeps the original `revoked_at`, so the record of when access ended survives a
   * double click.
   */
  async revoke(scope: AccessScope, shareId: string): Promise<void> {
    this.nodes.assertMayWrite(scope);

    const share = await this.shares.findInScope(scope, shareId);
    if (!share) throw new NotFoundException('Share not found.');

    await this.shares.revoke(scope, shareId);
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
