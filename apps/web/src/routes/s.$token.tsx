import { useMemo } from 'react';
import { useParams } from 'react-router';

import { DeadLinkState } from '@/features/node-browser/browser-states';
import { NodeView } from '@/features/node-browser/node-view';
import { PublicShareShell } from '@/features/share/public-share-shell';
import { shareSource } from '@/lib/node-source';

/**
 * A share link, opened by someone with no account and no session.
 *
 * **It sits outside `SessionGate`**, beside `/login`, `/privacy` and `/terms`, and for a
 * stronger reason than those: the gate redirects an unauthenticated visitor to `/login`,
 * and a share recipient must never be sent there — signing in would not grant them access,
 * because the token is the authorization and an account has nothing to do with it.
 *
 * The screen itself is `NodeView`, the same component the authenticated app uses, given a
 * share `source` instead of a room one. `role` arrives as `VIEWER`, which is what hides
 * create, rename, move, delete and upload — no second set of gating, and nothing the
 * server would not refuse anyway.
 *
 * An empty token is the dead-link screen rather than a `404`: the reader's problem is a
 * link that does not work, and which of the several ways it can fail to work is not
 * something they can act on.
 */
export function SharedNodeRootRoute() {
  const { token } = useParams<{ token: string }>();
  const source = useMemo(() => (token ? shareSource(token) : null), [token]);

  return (
    <PublicShareShell>
      {source ? <NodeView source={source} /> : <DeadLinkState />}
    </PublicShareShell>
  );
}
