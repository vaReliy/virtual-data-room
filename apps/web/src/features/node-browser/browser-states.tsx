import { Link } from 'react-router';
import { FileX, FolderOpen, FolderX, SearchX } from 'lucide-react';

import { Button } from '@/components/ui/button';

function Placard({
  icon,
  title,
  detail,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  detail: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-lg border border-dashed px-6 py-14 text-center">
      <div className="flex size-11 items-center justify-center rounded-full bg-muted">{icon}</div>
      <div className="space-y-1">
        <h2 className="text-base font-medium">{title}</h2>
        <p className="mx-auto max-w-sm text-sm text-muted-foreground">{detail}</p>
      </div>
      {action}
    </div>
  );
}

/**
 * `410 Gone` — the folder was deleted while the reader was standing in it. This is the
 * edge case `BRIEF.md` names, and the reason the API distinguishes it from `404` at all.
 *
 * **A dead end with a way back, not a redirect.** Nothing moves under the reader: they
 * asked for this folder and deserve to be told what happened to it, rather than to find
 * themselves somewhere else with no explanation. There is also no nearest-live-ancestor
 * to bounce to — the subtree delete stamps every ancestor in the same statement, so any
 * bounce would land at the room root anyway, which is exactly what this link offers
 * explicitly.
 *
 * It fires only for a caller *inside* the deleted folder. A deleted child simply stops
 * appearing in its parent's next listing; that is not an error and has no screen.
 */
export function DeletedFolderState({ roomId }: { roomId: string }) {
  return (
    <Placard
      icon={<FolderX className="size-5 text-muted-foreground" />}
      title="This folder was deleted by the owner"
      detail="It is no longer part of this Data Room, and its contents went with it."
      action={
        <Button asChild variant="outline" size="sm">
          <Link to={`/rooms/${roomId}`}>Back to the Data Room</Link>
        </Button>
      }
    />
  );
}

/**
 * `410 Gone` for a **file**, owed since Phase 2 and built now that there are files.
 *
 * It is a second component, not a second destination: the copy names a file, and the link
 * goes back to the Data Room root exactly as the folder screen's does. It deliberately does
 * **not** link to the folder that held the file — a `410` carries a message but no node, so
 * on a direct load the client knows neither the parent nor even that this was a file.
 *
 * Which is why this wording is reachable only when the reader arrived already holding the
 * type: from a file row in the table, or from the preview they were reading when it was
 * deleted. Everywhere else `DeletedFolderState` is the fallback, and inventing a type field
 * on the error body to fix that would be adding to the contract to serve one sentence.
 */
export function DeletedFileState({ roomId }: { roomId: string }) {
  return (
    <Placard
      icon={<FileX className="size-5 text-muted-foreground" />}
      title="This file was deleted by the owner"
      detail="It is no longer part of this Data Room."
      action={
        <Button asChild variant="outline" size="sm">
          <Link to={`/rooms/${roomId}`}>Back to the Data Room</Link>
        </Button>
      }
    />
  );
}

/**
 * `404` — no such node, **or** one outside the caller's scope. The two are deliberately
 * indistinguishable: a `403` here would confirm that a document exists, which in a
 * due-diligence context is itself the information worth protecting.
 */
export function NodeNotFoundState({ roomId }: { roomId: string }) {
  return (
    <Placard
      icon={<SearchX className="size-5 text-muted-foreground" />}
      title="Not found"
      detail="This item does not exist, or it is not shared with you."
      action={
        <Button asChild variant="outline" size="sm">
          <Link to={`/rooms/${roomId}`}>Back to the Data Room</Link>
        </Button>
      }
    />
  );
}

/**
 * A live, reachable folder that simply has nothing in it yet. Not an error.
 *
 * Deliberately without its own "New folder" button. The toolbar already carries one a few
 * pixels above, and duplicating it here means the same action appears twice on the one
 * screen where there is least to look at. Keeping it in the toolbar alone also keeps it
 * in a fixed place: an empty-state button would vanish the moment the first folder
 * arrives, moving the control the user just learned to aim at.
 */
export function EmptyFolderState() {
  return (
    <Placard
      icon={<FolderOpen className="size-5 text-muted-foreground" />}
      title="Nothing here yet"
      detail="This folder is empty."
    />
  );
}
