/**
 * **Where a browsed node is being read from**, and it is the only thing that differs
 * between the authenticated app and the anonymous share surface.
 *
 * A signed-in reader browses a Data Room; a link recipient browses a token. Everything
 * downstream — the table, the breadcrumbs, the preview, the four states — is the same
 * component tree rooted differently, because the API answers both with
 * `browseResponseSchema` and a `role`. So rather than copying the hooks and the screens
 * into a second "public" feature that would drift, the source travels down as one value
 * and decides three things: the API path, the in-app link, and the cache key.
 *
 * The cache key matters most of the three. The same node id can legitimately be reachable
 * both ways — the owner is signed in, the visitor holds a link — and the two responses are
 * *not* interchangeable: they differ in `role`, in whether `room` travels, and in where
 * the breadcrumbs are clipped. Sharing one key would serve one caller the other's answer.
 * A share is keyed on its token and never on a room id, which the visitor does not have
 * and must not be handed.
 */
export type NodeSource =
  | { readonly kind: 'room'; readonly roomId: string }
  | { readonly kind: 'share'; readonly token: string };

export function roomSource(roomId: string): NodeSource {
  return { kind: 'room', roomId };
}

export function shareSource(token: string): NodeSource {
  return { kind: 'share', token };
}

/** The API prefix for one source: `/api/rooms/:roomId/nodes` or `/api/s/:token`. */
function base(source: NodeSource): string {
  return source.kind === 'room'
    ? `/api/rooms/${source.roomId}/nodes`
    : `/api/s/${encodeURIComponent(source.token)}`;
}

/** One node's segment. A share addresses nodes under `/n/`, a room directly under it. */
function nodeSegment(source: NodeSource, nodeId: string): string {
  return source.kind === 'room' ? `/${nodeId}` : `/n/${nodeId}`;
}

/** `undefined` is the caller's scope root, which has no node row to address. */
export function browsePath(source: NodeSource, nodeId?: string, cursor?: string): `/api/${string}` {
  const path = base(source) + (nodeId === undefined ? '' : nodeSegment(source, nodeId));
  return (
    cursor === undefined ? path : `${path}?cursor=${encodeURIComponent(cursor)}`
  ) as `/api/${string}`;
}

/** The presigned GET. `attachment` is signed into the URL; it is not a client attribute. */
export function contentPath(
  source: NodeSource,
  nodeId: string,
  disposition?: 'attachment',
): `/api/${string}` {
  const path = `${base(source)}${nodeSegment(source, nodeId)}/content`;
  return (
    disposition === undefined ? path : `${path}?disposition=${disposition}`
  ) as `/api/${string}`;
}

/**
 * The room a write is addressed to.
 *
 * **Write endpoints exist only under a room**, and that is structural rather than a rule
 * to remember: a token resolves to a `VIEWER` scope, and every mutation's first statement
 * is the service's `assertMayWrite`, which answers `404`. The share surface therefore
 * hides create, rename, move, delete and upload on `role` alone and never calls these.
 *
 * If one ever did, this throws before a request leaves the browser rather than sending a
 * share token to a path that does not accept one.
 */
function roomIdFor(source: NodeSource, action: string): string {
  if (source.kind !== 'room') {
    throw new Error(`A share link is read-only; ${action} has no endpoint here.`);
  }
  return source.roomId;
}

export function nodeMutationPath(source: NodeSource, nodeId: string): `/api/${string}` {
  return `/api/rooms/${roomIdFor(source, 'this change')}/nodes/${nodeId}`;
}

export function moveNodePath(source: NodeSource, nodeId: string): `/api/${string}` {
  return `/api/rooms/${roomIdFor(source, 'moving a node')}/nodes/${nodeId}/move`;
}

export function uploadPath(source: NodeSource, step: 'presign' | 'complete'): `/api/${string}` {
  return `/api/rooms/${roomIdFor(source, 'uploading')}/uploads/${step}`;
}

/** Where "up to the top" goes: the room root, or the share root. */
export function rootLink(source: NodeSource): string {
  return source.kind === 'room'
    ? `/rooms/${source.roomId}`
    : `/s/${encodeURIComponent(source.token)}`;
}

/** Where a row, a breadcrumb or a `..` goes. */
export function nodeLink(source: NodeSource, nodeId: string): string {
  return `${rootLink(source)}/n/${nodeId}`;
}

/**
 * The cache-key prefix. Two segments so the key stays a flat tuple of strings, and the
 * discriminator is carried explicitly — a token and a room id are both opaque strings,
 * and a key that dropped the kind would let one collide with the other.
 */
export function sourceKey(source: NodeSource): readonly [string, string] {
  return source.kind === 'room' ? ['room', source.roomId] : ['share', source.token];
}
