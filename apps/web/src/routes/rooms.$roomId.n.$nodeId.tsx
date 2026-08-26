import { useLocation, useParams } from 'react-router';
import type { NodeType } from '@dr/contracts';

import { NodeNotFoundState } from '@/features/node-browser/browser-states';
import { NodeView } from '@/features/node-browser/node-view';

/**
 * What the row that was clicked believed this node to be. It rides on the history entry, so
 * it survives a reload of that entry; a link arriving from outside the app carries nothing.
 */
function hintedType(state: unknown): NodeType | undefined {
  if (typeof state !== 'object' || state === null || !('nodeType' in state)) return undefined;
  const { nodeType } = state;
  return nodeType === 'FILE' || nodeType === 'FOLDER' ? nodeType : undefined;
}

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
  if (!roomId || !nodeId) return <NodeNotFoundState roomId={roomId ?? ''} />;

  return <NodeView roomId={roomId} nodeId={nodeId} hintedType={hintedType(state)} />;
}
