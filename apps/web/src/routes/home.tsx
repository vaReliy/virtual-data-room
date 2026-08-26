import { Navigate } from 'react-router';

import { useSessionContext } from '@/features/session/session-gate';

/**
 * `/` never renders content — it always redirects to the caller's own Data Room. A user
 * owns exactly one room (decision #23: no room list, no switcher, no create-room route), so
 * that room is always the destination. "Shared with me" moved to its own route, `/shared`,
 * reachable from `AppShell`'s nav — it no longer shares this route with the redirect.
 *
 * There is no zero-room branch here on purpose: `SessionGate` renders that case as the
 * shell's *error* state before this route is reached, since an empty `dataRooms` means
 * provisioning failed rather than that the user has nothing yet.
 */
export function HomeRoute() {
  const { dataRooms } = useSessionContext();
  const [firstRoom] = dataRooms;

  // Unreachable: the gate above has already established that the list is not empty.
  if (!firstRoom) return null;

  return <Navigate to={`/rooms/${firstRoom.id}`} replace />;
}
