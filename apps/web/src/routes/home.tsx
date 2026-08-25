import { Navigate } from 'react-router';
import { FolderPlus } from 'lucide-react';

import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useSessionContext } from '@/features/session/session-gate';

/**
 * `/` is a resolver, not a screen. The OAuth callback redirects to the app root, and
 * decision #21 keeps the room UI minimal — no room list route — so the landing point is
 * the user's room itself.
 */
export function HomeRoute() {
  const { dataRooms } = useSessionContext();
  const [firstRoom] = dataRooms;

  if (firstRoom) return <Navigate to={`/rooms/${firstRoom.id}`} replace />;

  // Reachable only if auto-provisioning failed or a room was removed out of band. The
  // create-room affordance that resolves it belongs to Phase 2 (decision #21), so this
  // says what is true rather than offering a button that does not exist yet.
  return (
    <div className="mx-auto w-full max-w-4xl">
      <Card>
        <CardHeader>
          <div className="mb-2 flex size-10 items-center justify-center rounded-lg bg-muted">
            <FolderPlus className="size-5 text-muted-foreground" />
          </div>
          <CardTitle>No Data Room yet</CardTitle>
          <CardDescription>
            Your account is not associated with a Data Room. Sign out and back in to have one
            provisioned.
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}
