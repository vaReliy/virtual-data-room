import { Navigate, Outlet, useOutletContext } from 'react-router';
import type { MeResponse } from '@dr/contracts';

import { ErrorState } from './error-state';
import { AppShell, AppShellSkeleton } from './app-shell';
import { isUnauthenticated, useSession } from './use-session';

/**
 * The layout route behind which every authenticated screen sits. It owns three of the
 * four states so no child screen has to repeat them: pending, unauthenticated, failed.
 * The fourth — content — is delegated through the outlet context.
 */
export function SessionGate() {
  const session = useSession();

  if (session.isPending) return <AppShellSkeleton />;

  if (session.isError) {
    // Not signed in is a route, not an error screen. Anything else genuinely failed.
    if (isUnauthenticated(session.error)) return <Navigate to="/login" replace />;
    return (
      <div className="flex h-full items-center justify-center p-6">
        <ErrorState
          error={session.error}
          onRetry={() => {
            void session.refetch();
          }}
        />
      </div>
    );
  }

  return (
    <AppShell user={session.data.user}>
      <Outlet context={session.data satisfies MeResponse} />
    </AppShell>
  );
}

/** Typed access to the session the gate already resolved. Children never refetch it. */
export function useSessionContext(): MeResponse {
  return useOutletContext<MeResponse>();
}
