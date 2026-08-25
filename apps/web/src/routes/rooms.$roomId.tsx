import { useParams } from 'react-router';
import { FolderOpen, Inbox } from 'lucide-react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ErrorState } from '@/features/session/error-state';
import { useSessionContext } from '@/features/session/session-gate';
import { ApiError } from '@/lib/api-client';
import { formatBytes, pluralize } from '@/lib/formatters';

/**
 * The Data Room browser shell. Its aggregates come straight from `GET /api/me`: they are
 * denormalized counters maintained on every mutation (decision #5), so the whole subtree
 * summary costs no extra query however large the room grows.
 *
 * The contents region is intentionally the empty state only. Nothing in this phase can
 * put a node in a room, and the listing endpoint arrives in Phase 2 — which replaces
 * this region with the node browser rather than adding to it.
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

  const isEmpty = room.fileCount === 0 && room.folderCount === 0;

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h1 className="text-xl font-semibold tracking-tight">{room.name}</h1>
        <p className="text-sm text-muted-foreground">
          {pluralize(room.folderCount, 'folder')} · {pluralize(room.fileCount, 'file')} ·{' '}
          {formatBytes(room.totalSize)}
        </p>
      </div>

      {isEmpty ? (
        <EmptyRoom />
      ) : (
        <RoomSummary fileCount={room.fileCount} folderCount={room.folderCount} />
      )}
    </div>
  );
}

function EmptyRoom() {
  return (
    <Card className="border-dashed">
      <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
        <div className="flex size-11 items-center justify-center rounded-full bg-muted">
          <Inbox className="size-5 text-muted-foreground" />
        </div>
        <CardTitle className="text-base">This Data Room is empty</CardTitle>
        <CardDescription className="max-w-sm">
          Folders and files you add will appear here. Everything stays private until you share it.
        </CardDescription>
      </CardContent>
    </Card>
  );
}

/** What the API can currently say about a non-empty room. Phase 2 lists its contents. */
function RoomSummary({ fileCount, folderCount }: { fileCount: number; folderCount: number }) {
  return (
    <Card>
      <CardHeader>
        <div className="mb-2 flex size-10 items-center justify-center rounded-lg bg-muted">
          <FolderOpen className="size-5 text-muted-foreground" />
        </div>
        <CardTitle className="text-base">
          {pluralize(folderCount, 'folder')} and {pluralize(fileCount, 'file')}
        </CardTitle>
        <CardDescription>
          Browsing the contents of a Data Room arrives in the next phase.
        </CardDescription>
      </CardHeader>
    </Card>
  );
}
