import { useParams } from 'react-router';

import { NodeBrowser } from '@/features/node-browser/node-browser';
import { NodeNotFoundState } from '@/features/node-browser/browser-states';

/**
 * One folder inside a Data Room. The same component as the room root renders it: the
 * browse endpoint answers both with one shape, and a folder differs from the root only
 * in having a `node` and a breadcrumb trail (decision #24).
 *
 * A malformed `nodeId` is not special-cased here. The API validates it with
 * `ParseUUIDPipe` and answers `400`, and inventing a client-side rule about what a valid
 * id looks like is how the two definitions drift apart.
 */
export function NodeRoute() {
  const { roomId, nodeId } = useParams<{ roomId: string; nodeId: string }>();
  if (!roomId || !nodeId) return <NodeNotFoundState roomId={roomId ?? ''} />;

  return <NodeBrowser roomId={roomId} nodeId={nodeId} />;
}
