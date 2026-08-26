import { useMemo } from 'react';
import { useParams } from 'react-router';

import { NodeNotFoundState } from '@/features/node-browser/browser-states';
import { NodeView } from '@/features/node-browser/node-view';
import { roomSource } from '@/lib/node-source';

/**
 * The Data Room root. No `nodeId`, so the browse endpoint answers with `node: null`, an
 * empty breadcrumb trail and the room itself.
 *
 * **The ownership gate that used to live here is gone**, and its removal is the point of
 * this route rather than a tidy-up. It read the room out of `GET /api/me` and rendered a
 * client-side `404` when it was not there — but `/api/me` lists the rooms the caller
 * *owns*, and a whole-room `USER` share (`rootNodeId === null`) lands on exactly this
 * route. Leaving the gate would lock a valid grantee out one door over from the one
 * `rooms.$roomId.n.$nodeId.tsx` was careful to leave open (decision #24).
 *
 * Existence is the API's answer, and only the API's.
 */
export function RoomRoute() {
  const { roomId } = useParams<{ roomId: string }>();
  // Memoized because the source is a hook dependency all the way down — the upload
  // queue's `enqueue` is rebuilt from it — and a fresh object every render would rebuild
  // that callback on every render for no reason.
  const source = useMemo(() => (roomId ? roomSource(roomId) : null), [roomId]);

  if (!source) return <NodeNotFoundState source={null} />;

  return <NodeView source={source} />;
}
