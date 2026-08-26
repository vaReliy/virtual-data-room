import { Injectable } from '@nestjs/common';
import type { NodeType, Role, ShareMode } from '@dr/contracts';

import type { AccessScope } from '../../access/access-scope';
import { PrismaService } from '../../persistence/prisma.service';

/** A `Share` row as the rest of the API sees it. `tokenHash` deliberately never leaves. */
export interface ShareRecord {
  id: string;
  dataRoomId: string;
  nodeId: string | null;
  mode: ShareMode;
  role: Role;
  granteeEmail: string | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}

/** What a new share needs. `tokenHash` is set for `LINK` only, `granteeEmail` for `USER` only. */
export interface NewShare {
  nodeId: string | null;
  mode: ShareMode;
  tokenHash: string | null;
  granteeEmail: string | null;
  expiresAt: Date | null;
  createdById: string;
}

/**
 * One row of "Shared with me": the grant, plus the names needed to render it.
 *
 * `node` is `null` for a whole-room grant, and carries `deletedAt` because the caller has
 * to decide what to do about a grant whose folder the owner has since deleted.
 */
export interface GrantedShareRecord extends ShareRecord {
  node: { id: string; name: string; type: NodeType; deletedAt: Date | null } | null;
  dataRoom: { name: string };
  createdBy: { name: string | null; email: string };
}

/**
 * `Share` rows: written, listed, revoked and — the half that matters — resolved.
 *
 * Plain Prisma throughout. `Share` is not in `SOFT_DELETABLE_MODELS`, so the soft-delete
 * extension leaves these reads alone; a share is revoked, not deleted, and `revoked_at` is
 * an ordinary column that every read below filters itself. The one place deletion matters
 * is a grant pointing at a node the owner has since removed, and that predicate is written
 * out at its call site rather than assumed — the extension does **not** narrow a relation
 * filter nested inside a query on another model.
 *
 * Three methods here take no `AccessScope`, each for a reason recorded in
 * `architecture.md` § Scope-exception inventory. They run *before* a scope exists, which
 * is the only legitimate reason for one to be missing.
 */
@Injectable()
export class ShareRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(scope: AccessScope, input: NewShare): Promise<ShareRecord> {
    const share = await this.prisma.client.share.create({
      data: {
        dataRoomId: scope.dataRoomId,
        nodeId: input.nodeId,
        mode: input.mode,
        tokenHash: input.tokenHash,
        granteeEmail: input.granteeEmail,
        expiresAt: input.expiresAt,
        createdById: input.createdById,
      },
      select: this.selection,
    });
    return this.toRecord(share);
  }

  /**
   * The live shares on one node, or on the room itself when `nodeId` is `null`.
   *
   * Bounded by `scope.dataRoomId`: a node id from another room selects nothing, which is
   * the same answer as a node that does not exist.
   */
  async listLiveForNode(scope: AccessScope, nodeId: string | null): Promise<ShareRecord[]> {
    const shares = await this.prisma.client.share.findMany({
      where: { dataRoomId: scope.dataRoomId, nodeId, ...liveWhere() },
      orderBy: { createdAt: 'asc' },
      select: this.selection,
    });
    return shares.map((share) => this.toRecord(share));
  }

  /**
   * One share by id, live or not, bounded by the room.
   *
   * A share id from another room is indistinguishable from one that was never issued —
   * `404`, never `403`, for the same reason a node outside a scope is.
   */
  async findInScope(scope: AccessScope, shareId: string): Promise<ShareRecord | null> {
    const share = await this.prisma.client.share.findFirst({
      where: { id: shareId, dataRoomId: scope.dataRoomId },
      select: this.selection,
    });
    return share ? this.toRecord(share) : null;
  }

  /**
   * Stamps `revoked_at`. Idempotent by construction: `revokedAt: null` in the `where`
   * means a second revoke updates nothing rather than moving the timestamp forward, so the
   * record of *when* access ended survives a double click.
   */
  async revoke(scope: AccessScope, shareId: string): Promise<void> {
    await this.prisma.client.share.updateMany({
      where: { id: shareId, dataRoomId: scope.dataRoomId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /**
   * **Scope exception.** Every live `USER` grant held by one address in one room.
   *
   * It takes no `AccessScope` because it runs before one exists — producing one is its
   * purpose. What bounds it instead is `dataRoomId` plus an email the caller has already
   * established is *verified*; an unverified address must never reach this method, or
   * registering an account on somebody else's address would steal their access
   * (decision #7).
   */
  async findLiveGrantsForEmail(dataRoomId: string, email: string): Promise<ShareRecord[]> {
    const shares = await this.prisma.client.share.findMany({
      where: { dataRoomId, mode: 'USER', granteeEmail: email, ...liveWhere() },
      select: this.selection,
    });
    return shares.map((share) => this.toRecord(share));
  }

  /**
   * **Scope exception.** The live share behind a token hash.
   *
   * It takes neither a scope nor a room id, and cannot: the token is the only input there
   * is, and it *is* the authorization — possession of the hash preimage is the capability.
   * Bounded by the unique index `shares_token_hash_key`, so at most one row can match.
   *
   * No `mode` filter, and none is needed: `shares_mode_check` keeps `token_hash` null on
   * every `USER` row, so a token can only ever find a `LINK`.
   */
  async findLiveByTokenHash(tokenHash: string): Promise<ShareRecord | null> {
    const share = await this.prisma.client.share.findFirst({
      where: { tokenHash, ...liveWhere() },
      select: this.selection,
    });
    return share ? this.toRecord(share) : null;
  }

  /**
   * **Scope exception.** Every live grant held by one address, **across rooms** — that is
   * what "Shared with me" is, and bounding it to one room would defeat it. What bounds it
   * is the verified session email alone.
   *
   * A grant whose node the owner has since deleted is dropped here rather than returned as
   * a dead row: the listing is a menu of places to go. The predicate is written out because
   * the soft-delete extension narrows a query on `Node`, not a relation filter inside a
   * query on `Share`.
   */
  async listForGrantee(email: string): Promise<GrantedShareRecord[]> {
    const shares = await this.prisma.client.share.findMany({
      where: {
        mode: 'USER',
        granteeEmail: email,
        // `AND`, not a second `OR` key beside the first: two `OR`s in one object literal
        // are one property written twice, and the liveness predicate would vanish.
        AND: [liveWhere(), { OR: [{ nodeId: null }, { node: { deletedAt: null } }] }],
      },
      orderBy: { createdAt: 'desc' },
      select: {
        ...this.selection,
        node: { select: { id: true, name: true, type: true, deletedAt: true } },
        dataRoom: { select: { name: true } },
        createdBy: { select: { name: true, email: true } },
      },
    });

    return shares.map((share) => ({
      ...this.toRecord(share),
      node: share.node,
      dataRoom: share.dataRoom,
      createdBy: share.createdBy,
    }));
  }

  private toRecord(share: {
    id: string;
    dataRoomId: string;
    nodeId: string | null;
    mode: ShareMode;
    role: Role;
    granteeEmail: string | null;
    expiresAt: Date | null;
    revokedAt: Date | null;
    createdAt: Date;
  }): ShareRecord {
    return {
      id: share.id,
      dataRoomId: share.dataRoomId,
      nodeId: share.nodeId,
      mode: share.mode,
      role: share.role,
      granteeEmail: share.granteeEmail,
      expiresAt: share.expiresAt,
      revokedAt: share.revokedAt,
      createdAt: share.createdAt,
    };
  }

  /** `token_hash` is absent on purpose: nothing outside this file may read it. */
  private readonly selection = {
    id: true,
    dataRoomId: true,
    nodeId: true,
    mode: true,
    role: true,
    granteeEmail: true,
    expiresAt: true,
    revokedAt: true,
    createdAt: true,
  } as const;
}

/**
 * "Live" is the same three predicates everywhere — not revoked, and either never expiring
 * or not expired yet — and they are written once rather than per call site. A read that
 * spells them out itself is a read that will disagree with the others after the next edit.
 */
function liveWhere() {
  return {
    revokedAt: null,
    OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
  };
}
