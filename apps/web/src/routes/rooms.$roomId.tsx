import { useParams } from 'react-router';
import { FolderOpen } from 'lucide-react';

import { Card, CardContent, CardDescription, CardTitle } from '@/components/ui/card';
import { ErrorState } from '@/features/session/error-state';
import { useSessionContext } from '@/features/session/session-gate';
import { ApiError } from '@/lib/api-client';

/**
 * A placeholder standing between two shapes, and deliberately not a screen worth
 * investing in.
 *
 * The aggregates it used to render came from `GET /api/me`, which no longer carries them:
 * from Phase 2 every folder mutation changes them, so they travel with the thing being
 * viewed instead (decision #24). The counts now arrive from
 * `GET /api/rooms/:roomId/nodes`, which the node browser calls — and that browser, the
 * route it lives on, and the removal of the ownership gate below all land together in the
 * next session. Wiring half of it here would mean writing this screen twice.
 *
 * Two things go when it is replaced: the `dataRooms.find` gate — a room reached through a
 * `USER` share is not a room the caller *owns*, so deriving existence from `/api/me` locks
 * a valid grantee out before the API is ever asked — and this card.
 */
export function RoomRoute() {
  const { roomId } = useParams<{ roomId: string }>();
  const { dataRooms } = useSessionContext();

  const room = dataRooms.find((candidate) => candidate.id === roomId);

  // A room id that is not one of the caller's own is indistinguishable from one that
  // does not exist — 404, never 403 (see the error contract).
  if (!room) {
    return (
      <div className="mx-auto w-full max-w-4xl">
        <ErrorState error={new ApiError(404, 'This Data Room does not exist.')} />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6">
      <h1 className="text-xl font-semibold tracking-tight">{room.name}</h1>

      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
          <div className="flex size-11 items-center justify-center rounded-full bg-muted">
            <FolderOpen className="size-5 text-muted-foreground" />
          </div>
          <CardTitle className="text-base">Contents are not on screen yet</CardTitle>
          <CardDescription className="max-w-sm">
            The API serves this room&rsquo;s folders, their subtree totals and everything above
            them. The browser that renders them arrives with the next screen.
          </CardDescription>
        </CardContent>
      </Card>
    </div>
  );
}
