import { useMemo } from 'react';
import { useLocation, useParams } from 'react-router';

import { NodeNotFoundState } from '@/features/node-browser/browser-states';
import { NodeView, hintedTypeOf } from '@/features/node-browser/node-view';
import { roomSource } from '@/lib/node-source';

/**
 * One node inside a Data Room — **a folder or a file, on the same route**. The browse
 * endpoint already answers for a file id (the node resolves, `children` is empty, the
 * breadcrumbs are correct), so `NodeView` dispatches on `node.type` once the response is in
 * hand rather than the URL claiming a type the client cannot know before it asks.
 *
 * A malformed `nodeId` is not special-cased here. The API validates it with
 * `ParseUUIDPipe` and answers `400`, and inventing a client-side rule about what a valid
 * id looks like is how the two definitions drift apart.
 *
 * Navigation state carries the type the table already knew. It is a hint and nothing more —
 * the response overrides it the moment one arrives — and its only job is the file `410`
 * screen, which is unreachable otherwise: a `410` body names no type.
 */
export function NodeRoute() {
  const { roomId, nodeId } = useParams<{ roomId: string; nodeId: string }>();
  // Typed `unknown` on purpose: navigation state is whatever the previous screen put
  // there, including nothing at all on a pasted link, and React Router types it as `any`.
  const state: unknown = useLocation().state;
  const source = useMemo(() => (roomId ? roomSource(roomId) : null), [roomId]);

  if (!source || !nodeId) return <NodeNotFoundState source={source} />;

  return <NodeView source={source} nodeId={nodeId} hintedType={hintedTypeOf(state)} />;
}
