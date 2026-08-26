/**
 * One place where cache keys are spelled, so an invalidation and the query it is meant
 * to invalidate cannot drift apart. Decision #13 puts the whole browser view behind a
 * single endpoint, so the key set stays small on purpose.
 */
export const queryKeys = {
  /** `GET /api/me` — the session subject and the Data Rooms they own. */
  session: ['session'] as const,

  /**
   * `GET /api/rooms/:roomId/nodes/:nodeId?` — one location's node, breadcrumbs, children
   * and (at the room root) the room itself.
   *
   * `nodeId` is `undefined` at the room root, normalized to `'root'` so the key stays a
   * tuple of strings. One mutation invalidates exactly one of these keys: the aggregates
   * now travel with the thing being viewed (decision #24), so the header and the table
   * refetch together. Content mutations must **not** touch `session` — that coupling is
   * precisely what #24 removed.
   */
  browse: (roomId: string, nodeId?: string) => ['browse', roomId, nodeId ?? 'root'] as const,

  /**
   * `GET /api/rooms/:roomId/nodes/:nodeId/content` — a presigned GET that lives 300
   * seconds.
   *
   * It has a key so that it can be *invalidated*, not so that it can be reused: the query
   * that owns it sets `staleTime: 0` and `gcTime: 0`, because a URL cached for longer than
   * it is valid is handed back dead, and the failure surfaces as a storage-provider XML
   * document inside the preview frame (decision #15).
   */
  content: (roomId: string, nodeId: string) => ['content', roomId, nodeId] as const,
} as const;
