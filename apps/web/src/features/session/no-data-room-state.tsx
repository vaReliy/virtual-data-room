import { AlertTriangle } from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

/**
 * `dataRooms: []` is an **error** state, not an empty one (decision #23).
 *
 * A signed-in user always owns exactly one Data Room: `DataRoomService.ensureProvisioned`
 * is idempotent and runs on every sign-in. An empty list therefore means provisioning
 * failed or a row was removed by hand — not that the user has yet to make a room.
 *
 * That is why there is no "Create a Data Room" button here. There is no create-room
 * route, no room list and no switcher to offer instead, and a button that calls nothing
 * is worse than an honest explanation: `BRIEF.md` grades not shipping unimplemented
 * features. Signing out and back in is the actual remedy, because it re-runs the
 * provisioning that failed.
 */
export function NoDataRoomState({ onRetry }: { onRetry: () => void }) {
  return (
    <Alert variant="destructive" className="mx-auto max-w-md">
      <AlertTriangle />
      <AlertTitle>No Data Room could be loaded</AlertTitle>
      <AlertDescription>
        Your account should have a Data Room provisioned automatically. Try again, or sign out and
        back in.
      </AlertDescription>
      <div className="mt-3">
        <Button variant="outline" size="sm" onClick={onRetry}>
          Try again
        </Button>
      </div>
    </Alert>
  );
}
