import { sourceKey, type NodeSource } from './node-source';

/**
 * One place where cache keys are spelled, so an invalidation and the query it is meant
 * to invalidate cannot drift apart. Decision #13 puts the whole browser view behind a
 * single endpoint, so the key set stays small on purpose.
 */
export const queryKeys = {
  /** `GET /api/me` — the session subject and the Data Rooms they own. */
  session: ['session'] as const,

  /**
   * One location's node, breadcrumbs, children and — at a whole-room scope root — the room
   * itself. `GET /api/rooms/:roomId/nodes/:nodeId?` for a signed-in reader, `GET
   * /api/s/:token/n/:nodeId?` for a link recipient.
   *
   * **The source is part of the key, not a detail of the URL.** The same node id can be
   * reachable both ways at once, and the two answers are not interchangeable: they differ
   * in `role`, in whether `room` travels, and in where the breadcrumbs are clipped. One
   * shared key would hand a signed-out visitor an owner's answer, or the reverse.
   *
   * `nodeId` is `undefined` at the scope root, normalized to `'root'` so the key stays a
   * tuple of strings. One mutation invalidates exactly one of these keys: the aggregates
   * now travel with the thing being viewed (decision #24), so the header and the table
   * refetch together. Content mutations must **not** touch `session` — that coupling is
   * precisely what #24 removed.
   */
  browse: (source: NodeSource, nodeId?: string) =>
    [...sourceKey(source), 'browse', nodeId ?? 'root'] as const,

  /**
   * `…/:nodeId/content` — a presigned GET that lives 300 seconds.
   *
   * It has a key so that it can be *invalidated*, not so that it can be reused: the query
   * that owns it sets `staleTime: 0` and `gcTime: 0`, because a URL cached for longer than
   * it is valid is handed back dead, and the failure surfaces as a storage-provider XML
   * document inside the preview frame (decision #15).
   */
  content: (source: NodeSource, nodeId: string) =>
    [...sourceKey(source), 'content', nodeId] as const,

  /**
   * `GET /api/rooms/:roomId/shares` — the live shares on one node, or, with `nodeId: null`,
   * on the whole Data Room. Owner-only and room-scoped: unlike `browse`, there is no second
   * way to reach the same list (a `/s/:token` visitor can never call this endpoint), so the
   * key carries no `NodeSource`.
   */
  shares: (roomId: string, nodeId: string | null) =>
    ['room', roomId, 'shares', nodeId ?? 'room'] as const,

  /**
   * `GET /api/shares/shared-with-me` — one row per live grant the caller holds, across
   * rooms. Neither a room id nor a `NodeSource` applies: the endpoint takes neither, and
   * nothing in the app invalidates this key — grants are created by other people.
   */
  sharedWithMe: ['shared-with-me'] as const,
} as const;
