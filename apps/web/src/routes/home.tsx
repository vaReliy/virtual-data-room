import { Navigate } from 'react-router';

import { Skeleton } from '@/components/ui/skeleton';
import { useSessionContext } from '@/features/session/session-gate';
import { SharedWithMeSection } from '@/features/share/shared-with-me-section';
import { useSharedWithMe } from '@/features/share/use-shared-with-me';

/**
 * `/` is a resolver, not a pure one anymore: the OAuth callback redirects to the app root,
 * and a user owns exactly one Data Room (decision #23) — no room list, no switcher, no
 * create-room route — so the landing point is that room itself, **unless** the caller also
 * holds grants shared by other people, in which case this is the one place those surface.
 *
 * There is no zero-room branch here on purpose: `SessionGate` renders that case as the
 * shell's *error* state before this route is reached, since an empty `dataRooms` means
 * provisioning failed rather than that the user has nothing yet.
 *
 * The redirect must wait on `sharedWithMe`, not race it: deciding "no shares" before the
 * answer arrives would flash this screen for every user, including the common case of an
 * owner with none. A failed query also redirects — a grantee losing this list is a
 * degraded home screen, not a reason to strand a signed-in owner on an error page.
 */
export function HomeRoute() {
  const { dataRooms } = useSessionContext();
  const [firstRoom] = dataRooms;
  const sharedWithMe = useSharedWithMe();

  // Unreachable: the gate above has already established that the list is not empty.
  if (!firstRoom) return null;

  if (sharedWithMe.isPending) {
    return (
      <div className="mx-auto w-full max-w-2xl space-y-4">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  // Empty and error both redirect — there is no "no shares" state to build, and a
  // grantee's list failing to load must not block them from their own room.
  if (sharedWithMe.isError || sharedWithMe.data.length === 0) {
    return <Navigate to={`/rooms/${firstRoom.id}`} replace />;
  }

  return <SharedWithMeSection entries={sharedWithMe.data} />;
}
