import { useMemo } from 'react';
import { useLocation, useParams } from 'react-router';

import { DeadLinkState } from '@/features/node-browser/browser-states';
import { NodeView, hintedTypeOf } from '@/features/node-browser/node-view';
import { PublicShareShell } from '@/features/share/public-share-shell';
import { shareSource } from '@/lib/node-source';

/**
 * One node inside a share link — a folder or a file, on the same route, dispatched by
 * `NodeView` on `node.type` once the response arrives. The mirror of
 * `rooms.$roomId.n.$nodeId.tsx`, and deliberately the same component underneath: the only
 * difference between a shared folder and an owned one is which endpoint answered.
 *
 * The type hint rides on navigation state exactly as it does in the app, and buys the same
 * one thing: the file wording on the deleted screen, which a `410` body cannot supply.
 */
export function SharedNodeRoute() {
  const { token, nodeId } = useParams<{ token: string; nodeId: string }>();
  // Typed `unknown` on purpose: navigation state is whatever the previous screen put
  // there, including nothing at all on a pasted link, and React Router types it as `any`.
  const state: unknown = useLocation().state;
  const source = useMemo(() => (token ? shareSource(token) : null), [token]);

  return (
    <PublicShareShell>
      {source && nodeId ? (
        <NodeView source={source} nodeId={nodeId} hintedType={hintedTypeOf(state)} />
      ) : (
        <DeadLinkState />
      )}
    </PublicShareShell>
  );
}
