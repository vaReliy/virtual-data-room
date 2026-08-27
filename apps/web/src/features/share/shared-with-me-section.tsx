import { Link } from 'react-router';
import { Building2, File, Folder, Inbox } from 'lucide-react';
import type { SharedWithMeEntry } from '@dr/contracts';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatTimestamp } from '@/lib/formatters';

function entryHref(entry: SharedWithMeEntry): string {
  return entry.nodeId === null
    ? `/rooms/${entry.dataRoomId}`
    : `/rooms/${entry.dataRoomId}/n/${entry.nodeId}`;
}

function EntryIcon({ type }: { type: SharedWithMeEntry['type'] }) {
  if (type === 'ROOM') return <Building2 className="mt-0.5 size-4 shrink-0 text-muted-foreground" />;
  if (type === 'FOLDER') return <Folder className="mt-0.5 size-4 shrink-0 text-muted-foreground" />;
  return <File className="mt-0.5 size-4 shrink-0 text-muted-foreground" />;
}

/**
 * One row per live grant. `entry.name` is the granted node's name, never the room's —
 * except for a `'ROOM'` entry, where the room *is* the grantee's scope. Do not fetch or
 * display anything beyond what the row already carries: a subtree grantee must never learn
 * the name of anything above their grant, and the API already withholds it.
 */
function SharedWithMeRow({ entry }: { entry: SharedWithMeEntry }) {
  return (
    <li>
      <Link
        to={entryHref(entry)}
        className="flex items-start gap-2 rounded-md px-2 py-2 -mx-2 hover:bg-muted"
      >
        <EntryIcon type={entry.type} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{entry.name}</p>
          <p className="truncate text-xs text-muted-foreground">
            Shared by {entry.sharedBy.name ?? entry.sharedBy.email} · {formatTimestamp(entry.createdAt)}
          </p>
        </div>
      </Link>
    </li>
  );
}

/**
 * The `/shared` route's "Shared with me" list, rendered unconditionally — including when
 * there is nothing to show.
 */
export function SharedWithMeSection({ entries }: { entries: SharedWithMeEntry[] }) {
  return (
    <div className="mx-auto w-full max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle>Shared with me</CardTitle>
        </CardHeader>
        <CardContent>
          {entries.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-10 text-center">
              <Inbox className="size-10 text-muted-foreground" strokeWidth={1.5} />
              <p className="text-sm text-muted-foreground">Nothing has been shared with you yet.</p>
            </div>
          ) : (
            <ul className="divide-y">
              {/* Keyed on the share's own id: the same node can legitimately be granted to
                  the same address twice, so room + node does not identify a row. */}
              {entries.map((entry) => (
                <SharedWithMeRow key={entry.id} entry={entry} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
