import { GoneException, Injectable, NotFoundException } from '@nestjs/common';

import { UserRepository } from '../modules/auth/user.repository';
import { DataRoomRepository } from '../modules/data-room/data-room.repository';
import { NodeRepository } from '../modules/node/node.repository';
import { hashShareToken } from '../modules/share/share-token';
import { ShareRepository, type ShareRecord } from '../modules/share/share.repository';
import { brandAccessScope, type AccessScope } from './access-scope';

/** A grant paired with the node it points at, once that node has been resolved. */
interface ResolvedGrant {
  share: ShareRecord;
  node: { id: string; path: string; deletedAt: Date | null };
}

/**
 * The single authorization decision point. It answers with a boundary — an
 * `AccessScope` — rather than with a yes or no, so that everything downstream is
 * confined by construction instead of by a check someone has to remember.
 *
 * It is the only producer of `AccessScope` in the system; see `access-scope.ts` for how
 * that is enforced rather than merely asked for.
 *
 * It reads `ShareRepository` and `NodeRepository` straight from `PersistenceModule` and
 * imports **no feature module**. `NodeModule` imports this one, so the reverse edge would
 * close a cycle — which is why the grant node lookup is called on the repository rather
 * than through `NodeService`.
 */
@Injectable()
export class AccessControlService {
  constructor(
    private readonly dataRooms: DataRoomRepository,
    private readonly shares: ShareRepository,
    private readonly nodes: NodeRepository,
    private readonly users: UserRepository,
  ) {}

  /**
   * Resolves what a signed-in user may reach inside a Data Room: the whole room if they
   * own it, otherwise the subtree of the broadest live `USER` grant held by their
   * **verified** email.
   *
   * It is called with a room id and no node id, so it has to choose **one** scope before
   * it knows what the caller is about to read. When several live grants exist in one room
   * the broadest wins — see `pickBroadest` for why that is a correctness rule rather than
   * a preference.
   *
   * **No grant is `404`, never `403`.** A `403` would confirm that the room exists, and
   * existence is itself information — the same reason a node outside a scope is
   * indistinguishable from one that was never created.
   */
  async resolveForUser(userId: string, dataRoomId: string): Promise<AccessScope> {
    const owned = await this.dataRooms.findOwnedById(userId, dataRoomId);
    if (owned) {
      return brandAccessScope({
        dataRoomId,
        // The whole room: there is no ancestor path to clip, so every node in the room
        // is inside the boundary and `path LIKE '/%'` matches all of them.
        rootNodeId: null,
        rootPath: '/',
        role: 'OWNER',
      });
    }

    // **Verified only** (decision #7). The session token carries `{ sub, email }` and no
    // verification flag, so it comes from the user row — one primary-key read, and only
    // on this path. Adding the claim to the JWT instead would log out every open session.
    // Without the rule, registering an account on somebody else's address steals whatever
    // was shared with them.
    const user = await this.users.findById(userId);
    if (!user?.emailVerified) throw new NotFoundException('Data Room not found.');

    const grants = await this.shares.findLiveGrantsForEmail(dataRoomId, user.email);
    if (grants.length === 0) throw new NotFoundException('Data Room not found.');

    // A whole-room grant subsumes every other, and needs no node lookup at all.
    if (grants.some((grant) => grant.nodeId === null)) return this.wholeRoomScope(dataRoomId);

    const resolved = await this.resolveGrantNodes(dataRoomId, grants);
    const broadest = pickBroadest(resolved);
    if (!broadest) throw new NotFoundException('Data Room not found.');

    // **A deleted grant node still produces a scope.** The `410` is raised where every
    // other one is — on the node itself, in `NodeService` — so that a grantee whose folder
    // was deleted gets "deleted by the owner" rather than the `404` that reads as "you
    // were never given this". Short-circuiting here would erase that difference.
    return brandAccessScope({
      dataRoomId,
      rootNodeId: broadest.node.id,
      // Inclusive: a node's own `path` starts with itself, so the shared node is inside
      // its own boundary.
      rootPath: broadest.node.path,
      role: 'VIEWER',
    });
  }

  /**
   * Resolves what the holder of a share token may reach. The **only** anonymous path in
   * the system: possession of the token is the authorization, so there is no session to
   * consult and no user to be.
   *
   * **Unknown, revoked and expired are one answer — `410`.** Distinguishing them would
   * separate real links from invented ones and buys the reader nothing: a person holding a
   * broken link needs "this link no longer works" in every case.
   *
   * There is no `mode` branch, and one would be dead code: `shares_mode_check` keeps
   * `token_hash` null on every `USER` row, so a token can only ever find a `LINK`.
   */
  async resolveForToken(token: string): Promise<AccessScope> {
    const share = await this.shares.findLiveByTokenHash(hashShareToken(token));
    if (!share) throw new GoneException('This link no longer works.');

    if (share.nodeId === null) return this.wholeRoomScope(share.dataRoomId);

    const node = await this.nodes.findGrantNodeInRoom(share.dataRoomId, share.nodeId);
    // The row cannot vanish — nodes are soft-deleted, never removed — so a miss here means
    // the share points outside its own room. That is not a state a caller can act on.
    if (!node) throw new GoneException('This link no longer works.');

    return brandAccessScope({
      dataRoomId: share.dataRoomId,
      rootNodeId: node.id,
      rootPath: node.path,
      role: 'VIEWER',
    });
  }

  /**
   * A grant on the room itself: the grantee's boundary is the whole room, exactly as an
   * owner's is, but `role` is `VIEWER` — the boundary answers reading, and every mutation
   * asks about the role separately (decision #25).
   */
  private wholeRoomScope(dataRoomId: string): AccessScope {
    return brandAccessScope({ dataRoomId, rootNodeId: null, rootPath: '/', role: 'VIEWER' });
  }

  /**
   * Pairs each grant with its node. A grant whose node cannot be found in this room is
   * dropped rather than raised: it is unreachable data, and one bad row must not take the
   * grantee's other grants down with it.
   */
  private async resolveGrantNodes(
    dataRoomId: string,
    grants: readonly ShareRecord[],
  ): Promise<ResolvedGrant[]> {
    const resolved = await Promise.all(
      grants.map(async (share) => {
        if (share.nodeId === null) return null;
        const node = await this.nodes.findGrantNodeInRoom(dataRoomId, share.nodeId);
        return node ? { share, node } : null;
      }),
    );
    return resolved.filter((entry): entry is ResolvedGrant => entry !== null);
  }
}

/**
 * **The broadest live grant defines the scope**, and this is a correctness rule rather
 * than a preference.
 *
 * Access is derived from ancestry, so a grant on `/Legal/` already subsumes one on
 * `/Legal/NDA.pdf`: picking the narrower would *hide* content the grantee has legitimately
 * been given, and they would have no way to discover it. The shortest `path` is the
 * highest ancestor, because a path is its whole ancestry.
 *
 * The tie-breaks — `createdAt` ascending, then `id` — are what make the answer
 * deterministic. Without them the same request could resolve to two different scopes on
 * two page loads, which is the kind of bug that is reported as "sometimes I can't see the
 * folder" and reproduces for nobody.
 */
function pickBroadest(grants: readonly ResolvedGrant[]): ResolvedGrant | null {
  return [...grants].sort(compareBreadth)[0] ?? null;
}

function compareBreadth(a: ResolvedGrant, b: ResolvedGrant): number {
  if (a.node.path.length !== b.node.path.length) return a.node.path.length - b.node.path.length;
  const byCreatedAt = a.share.createdAt.getTime() - b.share.createdAt.getTime();
  if (byCreatedAt !== 0) return byCreatedAt;
  return a.share.id.localeCompare(b.share.id);
}
