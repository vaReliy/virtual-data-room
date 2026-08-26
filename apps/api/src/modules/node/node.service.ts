import {
  BadRequestException,
  ConflictException,
  GoneException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  decodeCursor,
  encodeCursor,
  type BrowseResponse,
  type CreateFolderBody,
  type MoveNodeBody,
  type NodeSummary,
} from '@dr/contracts';

import type { AccessScope } from '../../access/access-scope';
import type { TransactionClient } from '../../persistence/prisma.service';
import { DataRoomRepository } from '../data-room/data-room.repository';
import { NameConflictError } from './node.errors';
import {
  ancestorIdsOf,
  LISTING_PAGE_SIZE,
  NodeRepository,
  type LiveNodeRecord,
  type NodeRecord,
} from './node.repository';

@Injectable()
export class NodeService {
  constructor(
    private readonly nodes: NodeRepository,
    private readonly dataRooms: DataRoomRepository,
  ) {}

  /**
   * **The single place the order of checks is run**, and therefore the only place a `404`
   * and a `410` are told apart:
   *
   * 1. no row → `404`. That covers both "no such node" and "outside your scope", because
   *    the statement cannot tell them apart — which is the point. A caller who guesses a
   *    UUID outside their scope must not learn that it exists.
   * 2. `deletedAt` set → `410`. Only ever seen by someone who was entitled to see the
   *    node while it was alive, since step 1 already excluded everyone else.
   *
   * The return type has **no `deletedAt` field**, which is what makes this unforgettable
   * rather than merely documented. A caller who wrote `if (!node) throw 404` against the
   * repository directly would compile and then serve a deleted node with a `200` — the
   * worst failure this system has (decision #6).
   */
  async resolveLiveNode(
    scope: AccessScope,
    id: string,
    tx?: TransactionClient,
  ): Promise<LiveNodeRecord> {
    const node = await this.nodes.findInScope(scope, id, tx);
    if (!node) throw new NotFoundException('Node not found.');
    if (node.deletedAt !== null) throw new GoneException('This item was deleted by the owner.');

    const { deletedAt: _deletedAt, ...live } = node;
    return live;
  }

  /**
   * Everything the browser renders for one location, in one call (decision #24).
   *
   * `nodeId` absent means the caller's scope root: `node` is `null` — a synthetic root
   * row with a fabricated id eventually gets treated as a real one — and `breadcrumbs` is
   * empty, since there is nowhere further up that the caller is allowed to know about.
   *
   * **A subtree-scoped caller's root is a real node, and it can have been deleted.** For
   * an owner there is nothing to check — the room root is not a node — but for a grantee
   * the shared folder itself is one, and every child of a deleted folder is stamped too.
   * Without the check below the listing comes back empty and the screen says "Nothing here
   * yet": a silent falsehood about somebody else's documents, where the truth is a `410`
   * and the "deleted by the owner" screen. The result is discarded on purpose — `node`
   * stays `null`, because the scope root still has no row this contract may describe.
   *
   * One extra query, on the grantee path only. An owner has `rootNodeId === null` and
   * never pays it.
   */
  async browse(scope: AccessScope, nodeId?: string, cursor?: string): Promise<BrowseResponse> {
    if (nodeId === undefined && scope.rootNodeId !== null) {
      await this.resolveLiveNode(scope, scope.rootNodeId);
    }

    const node = nodeId === undefined ? null : await this.resolveLiveNode(scope, nodeId);

    // The listing is keyed on COALESCE(parent_id, data_room_id), so root-level children
    // are addressed by the room's id — the same key the uniqueness index uses.
    const parentKey = node?.id ?? scope.rootNodeId ?? scope.dataRoomId;

    const [breadcrumbs, page, room] = await Promise.all([
      this.breadcrumbsFor(scope, node),
      this.listChildren(scope, parentKey, cursor),
      // `room` travels only with a whole-room scope, and that is a security property
      // rather than a convenience: `Project Falcon` sits above a subtree share's root,
      // and so do the whole-room totals beside it.
      scope.rootNodeId === null ? this.dataRooms.findInScope(scope) : Promise.resolve(null),
    ]);

    return {
      ...(room ? { room } : {}),
      node: node ? this.toSummary(scope, node) : null,
      breadcrumbs,
      children: page.children,
      nextCursor: page.nextCursor,
      role: scope.role,
    };
  }

  /**
   * Creates a folder under `parentId`, or at the caller's scope root when it is `null`.
   *
   * There is no `type` parameter: this creates folders only, and a `FILE` node is born in
   * `POST /rooms/:roomId/uploads/complete`, never here, because it cannot exist without a
   * `READY` blob.
   */
  async createFolder(
    scope: AccessScope,
    body: CreateFolderBody,
    createdById: string,
  ): Promise<NodeSummary> {
    this.assertMayWrite(scope);

    const destination = await this.resolveParentLocation(scope, body.parentId);

    try {
      const created = await this.nodes.createFolder(scope, {
        ...destination,
        name: body.name,
        createdById,
      });
      return this.toSummary(scope, created);
    } catch (error) {
      throw asHttpError(error);
    }
  }

  /**
   * Renames a node. `409` on a taken name, with **no auto-suffix**: the user typed this
   * one, so inventing `Legal (1)` for them would silently produce something they did not
   * ask for (decision #20). Upload is the opposite case and does suffix, in Phase 3.
   */
  async rename(scope: AccessScope, nodeId: string, name: string): Promise<NodeSummary> {
    this.assertMayWrite(scope);

    // Resolving first is what makes a rename of a node deleted under an open dialog a
    // `410` rather than a silent no-op — the race is likeliest here, because the dialog
    // sits open for seconds.
    await this.resolveLiveNode(scope, nodeId);

    try {
      const renamed = await this.nodes.rename(scope, nodeId, name);
      return this.toSummary(scope, renamed);
    } catch (error) {
      throw asHttpError(error);
    }
  }

  /**
   * Relocates a node — file or folder, from one repository method — under a new parent.
   *
   * The order of the checks is the error contract, and each status is a different screen:
   *
   * - node or destination missing / outside the scope → `404`, deleted → `410`. Both come
   *   from `resolveLiveNode` and `resolveParentLocation`, which is why neither is spelled
   *   out below.
   * - destination is a `FILE` → `422`, from the same shared resolver.
   * - **destination is the node itself or one of its descendants → `422`, not `409`.** A
   *   conflict is a name the user can change; a cycle is a request that cannot be satisfied
   *   at all, and the dialog says so differently. The guard is
   *   `newParent.path.startsWith(node.path)` — no query, and it catches moving a node into
   *   itself for free, because a node's own path starts with itself.
   * - destination is already the current parent → `200`, a no-op. Checked after the guards
   *   above, so a request that is *both* nonsense and a no-op is still reported as nonsense.
   * - a live same-`lower(name)` in the destination → `409`, with **no auto-suffix**: the
   *   user chose the destination knowing its contents (decision #20). Upload is the
   *   opposite case, and it is the only one that suffixes.
   */
  async move(scope: AccessScope, nodeId: string, body: MoveNodeBody): Promise<NodeSummary> {
    this.assertMayWrite(scope);

    const node = await this.resolveLiveNode(scope, nodeId);
    const destination = await this.resolveParentLocation(scope, body.parentId);

    if (destination.parentPath.startsWith(node.path)) {
      throw new UnprocessableEntityException('A folder cannot be moved into itself.');
    }
    if (destination.parentId === node.parentId) {
      return this.toSummary(scope, node);
    }

    try {
      const moved = await this.nodes.move(scope, node, destination);
      return this.toSummary(scope, moved);
    } catch (error) {
      throw asHttpError(error);
    }
  }

  /**
   * Soft-deletes a node and its whole subtree. Replies with nothing: the warning dialog
   * was rendered *before* the call from the folder's denormalized aggregates, so there is
   * nothing left to tell the client that a cache invalidation does not.
   */
  async deleteSubtree(scope: AccessScope, nodeId: string): Promise<void> {
    this.assertMayWrite(scope);

    const node = await this.resolveLiveNode(scope, nodeId);
    await this.nodes.deleteSubtree(scope, node);
  }

  /**
   * **The write guard, and it is the first statement of every mutation above.**
   *
   * `404`, not `403`, like everything else here: two status codes for one boundary is how
   * the one case that does leak gets written later by analogy. It lives in the service
   * rather than in a Nest guard because a decorator would have to read the `AccessScope`
   * off ambient request state, and scopes are passed explicitly precisely so they cannot
   * be forged or forgotten (decision #25).
   *
   * Hiding "New folder" behind `role` in the UI is not access control — `curl` does not
   * read the UI.
   *
   * Public because the upload protocol is a mutation too: presign creates `Blob` rows and
   * complete creates a `Node`, so both assert it. The content URL deliberately does not —
   * it is a read, and a `VIEWER` must be able to open a file shared with them in Phase 4.
   */
  assertMayWrite(scope: AccessScope): void {
    if (scope.role !== 'OWNER') throw new NotFoundException('Node not found.');
  }

  /**
   * Where a new or moved node goes: a `parentId` resolved to a **live `FOLDER`**, or the
   * caller's scope root when it is `null`.
   *
   * **`422` when it resolves to a `FILE`.** Nothing in the database prevents a child under
   * one: `nodes_type_blob_check` ties `type` to `blob_id`, and the parent foreign key does
   * not look at the parent's type at all. A child under a file breaks the tree quietly —
   * breadcrumbs would route through a file, and a file would have "contents".
   *
   * This is the single implementation of that rule, shared by create, move and
   * upload-complete. `tx` is passed only by the last of them, which re-resolves its parent
   * *inside* the locked transaction: a 10 MB PUT takes seconds, and the parent can be
   * deleted during them. A live row under a deleted ancestor is the failure this system
   * rates worst — missing from its parent's listing and still readable by direct id.
   */
  async resolveParentLocation(
    scope: AccessScope,
    parentId: string | null,
    tx?: TransactionClient,
  ): Promise<{ parentId: string | null; parentPath: string }> {
    const resolved = parentId ?? scope.rootNodeId;
    if (resolved === null) return { parentId: null, parentPath: scope.rootPath };

    const parent = await this.resolveLiveNode(scope, resolved, tx);
    if (parent.type !== 'FOLDER') {
      throw new UnprocessableEntityException('A file cannot contain other nodes.');
    }
    return { parentId: resolved, parentPath: parent.path };
  }

  /**
   * Breadcrumbs, **clipped by arithmetic**: the ids come from the part of `path` that
   * lies below the scope root, so an ancestor above it is never even asked for. The last
   * id is the node itself, which is returned separately as `node`.
   */
  private async breadcrumbsFor(scope: AccessScope, node: LiveNodeRecord | null) {
    if (!node) return [];
    const withinScope = node.path.slice(scope.rootPath.length);
    return this.nodes.findAncestorsInScope(scope, ancestorIdsOf(withinScope).slice(0, -1));
  }

  /**
   * One page of children, plus the cursor for the next one.
   *
   * `LISTING_PAGE_SIZE + 1` rows are requested and at most `LISTING_PAGE_SIZE` returned:
   * the extra row is how "is there a next page" is answered without a second `COUNT` over
   * the folder. `nextCursor` is `null` on the last page — including when the last page is
   * exactly full, which the extra row is what distinguishes.
   */
  private async listChildren(scope: AccessScope, parentKey: string, cursor?: string) {
    const after = cursor === undefined ? null : decodeCursor(cursor);
    // The cursor is opaque, so one that does not decode was not issued by this API. That
    // is client tampering rather than a recoverable state.
    if (cursor !== undefined && after === null) {
      throw new BadRequestException('Invalid cursor.');
    }

    const rows = await this.nodes.listChildrenInScope(
      scope,
      parentKey,
      after,
      LISTING_PAGE_SIZE + 1,
    );
    const hasMore = rows.length > LISTING_PAGE_SIZE;
    const page = hasMore ? rows.slice(0, LISTING_PAGE_SIZE) : rows;
    const last = page.at(-1);

    return {
      children: page.map((row) => this.toSummary(scope, row)),
      // `lowerName` is the value Postgres computed for the ORDER BY, not a JavaScript
      // re-lowercasing of the name — see `ListedNodeRecord`.
      nextCursor:
        hasMore && last ? encodeCursor({ type: last.type, lowerName: last.lowerName }) : null,
    };
  }

  /**
   * The wire shape. `path` stops here — it is internal, built from UUIDs, and never
   * returned to a client.
   *
   * `parentId` is reported as `null` at the caller's scope root, so a client walking
   * upwards stops there instead of asking for a node that, for it, does not exist.
   *
   * Public because upload-complete returns a node it created through `NodeRepository`
   * directly, inside its own transaction. One wire shape, written once — `blobId` in
   * particular is on `NodeRecord` for the content endpoint and must not leave the API.
   */
  toSummary(scope: AccessScope, node: NodeRecord | LiveNodeRecord): NodeSummary {
    return {
      id: node.id,
      parentId: node.id === scope.rootNodeId ? null : node.parentId,
      type: node.type,
      name: node.name,
      size: node.size,
      totalSize: node.totalSize,
      fileCount: node.fileCount,
      folderCount: node.folderCount,
      updatedAt: node.updatedAt.toISOString(),
    };
  }
}

/**
 * A taken name becomes a `409` with no suffix (decision #20). Anything else travels on
 * untouched — an unexpected database error is a `500`, and dressing it up as a client
 * error would hide it.
 */
function asHttpError(error: unknown): unknown {
  if (error instanceof NameConflictError) return new ConflictException(error.message);
  return error;
}
