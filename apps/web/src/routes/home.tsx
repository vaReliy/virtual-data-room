import { Navigate } from 'react-router';

import { useSessionContext } from '@/features/session/session-gate';

/**
 * `/` is a resolver, not a screen. The OAuth callback redirects to the app root, and a
 * user owns exactly one Data Room (decision #23) — no room list, no switcher, no
 * create-room route — so the landing point is that room itself.
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
