import { Link } from 'react-router';
import { FileX, FolderOpen, FolderX, LinkIcon, SearchX } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { rootLink, type NodeSource } from '@/lib/node-source';

/**
 * "Back to where this reader started", which is not the same place for both readers: a
 * signed-in one goes to their Data Room, a link recipient to the share root. The wording
 * differs with it — a visitor holding a link has never heard of "the Data Room", and the
 * phrase would name something they cannot reach.
 */
function BackAction({ source }: { source: NodeSource }) {
  return (
    <Button asChild variant="outline" size="sm">
      <Link to={rootLink(source)}>
        {source.kind === 'room' ? 'Back to the Data Room' : 'Back to the shared folder'}
      </Link>
    </Button>
  );
}

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
export function DeletedFolderState({ source }: { source: NodeSource }) {
  return (
    <Placard
      icon={<FolderX className="size-5 text-muted-foreground" />}
      title="This folder was deleted by the owner"
      detail={
        source.kind === 'room'
          ? 'It is no longer part of this Data Room, and its contents went with it.'
          : 'It is no longer part of what was shared with you, and its contents went with it.'
      }
      action={<BackAction source={source} />}
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
export function DeletedFileState({ source }: { source: NodeSource }) {
  return (
    <Placard
      icon={<FileX className="size-5 text-muted-foreground" />}
      title="This file was deleted by the owner"
      detail={
        source.kind === 'room'
          ? 'It is no longer part of this Data Room.'
          : 'It is no longer part of what was shared with you.'
      }
      action={<BackAction source={source} />}
    />
  );
}

/**
 * `404` — no such node, **or** one outside the caller's scope. The two are deliberately
 * indistinguishable: a `403` here would confirm that a document exists, which in a
 * due-diligence context is itself the information worth protecting.
 */
export function NodeNotFoundState({ source }: { source: NodeSource | null }) {
  return (
    <Placard
      icon={<SearchX className="size-5 text-muted-foreground" />}
      title="Not found"
      detail="This item does not exist, or it is not shared with you."
      // `null` is a malformed URL — no room id, no token — so there is nowhere to send
      // the reader back to. A link to `/rooms/` or `/s/` would be a second 404.
      action={source ? <BackAction source={source} /> : undefined}
    />
  );
}

/**
 * `410 Gone` at the root of a share link — and it covers **four** causes, not three.
 *
 * Three come from the token: unknown, revoked, expired, which the API deliberately answers
 * alike. The token space is 256 bits, so nobody reaches an unknown one by guessing; they
 * reach it with a link that was truncated, mistyped, or killed.
 *
 * The fourth is the owner deleting the shared node itself while the link stays live —
 * `BRIEF.md`'s "deleting a folder that is being viewed by someone it was shared with".
 * The server answers that with the same `410` (a live token whose scope root is stamped),
 * and a `410` carries a message and no node, so the client **cannot** tell it from a dead
 * token. The copy therefore names all four rather than asserting the likeliest one:
 * telling a visitor their link was revoked when the folder was actually deleted would send
 * them back to the sender for a replacement that cannot exist.
 *
 * **A dead end with no way out, and that is the honest shape.** There is no link and no
 * sign-in button: an anonymous visitor has nowhere in this application to go, and signing
 * in would not grant them access — offering it would be a dead end dressed as an exit.
 * The one action that helps is asking whoever sent the link, which the copy says.
 */
export function DeadLinkState() {
  return (
    <Placard
      icon={<LinkIcon className="size-5 text-muted-foreground" />}
      title="This link is no longer available"
      detail="It may have been revoked or expired, or the shared item may have been deleted by its owner. Ask whoever sent it to you for a new one."
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
