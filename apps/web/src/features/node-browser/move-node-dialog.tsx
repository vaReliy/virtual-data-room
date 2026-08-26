import { useState } from 'react';
import { ChevronRight, CornerLeftUp, Folder } from 'lucide-react';
import type { NodeSummary } from '@dr/contracts';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError, NetworkError } from '@/lib/api-client';
import { useBrowse } from './use-node-browser';

/**
 * A failed move, in the words of the thing that failed. `409` is the one the user can act
 * on, and decision #20 is explicit that move does **not** auto-suffix: the destination was
 * chosen knowing what is in it, so the name stands and the user renames or picks elsewhere.
 */
function describeFailure(error: Error): string {
  if (error instanceof NetworkError) return 'The server could not be reached.';
  if (error instanceof ApiError) {
    if (error.status === 409) return error.message;
    if (error.status === 422) return error.message;
    if (error.status === 410) return 'That folder was deleted. Pick another destination.';
    if (error.status === 404) return 'That folder no longer exists.';
    return error.message;
  }
  return error.message;
}

/**
 * The **primary** move affordance (decision #19). Drag-and-drop ships beside it, but this
 * is the one that satisfies the brief on its own: it is reachable by keyboard, it is
 * announced by a screen reader, it works on touch, and it can be tested by clicking.
 *
 * The picker walks the tree with the *same* browse query the table uses, so opening it on a
 * folder that is already on screen costs no request. Only folders are listed — a file
 * cannot contain anything, so listing files would be offering a destination that is a `422`
 * waiting to happen.
 */
export function MoveNodeDialog({
  roomId,
  node,
  rootLabel,
  open,
  onOpenChange,
  onMove,
}: {
  roomId: string;
  node: NodeSummary | null;
  rootLabel: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onMove: (destinationId: string | null) => Promise<void>;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {node ? (
          // Keyed on the node, so the picker starts at the root again for a different row
          // rather than wherever the previous move left it — and so the last failure goes
          // with it. Radix unmounts the closed dialog, which resets it on close too.
          <MoveNodeForm
            key={node.id}
            roomId={roomId}
            node={node}
            rootLabel={rootLabel}
            onMove={onMove}
            onCancel={() => {
              onOpenChange(false);
            }}
            onMoved={() => {
              onOpenChange(false);
            }}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function MoveNodeForm({
  roomId,
  node,
  rootLabel,
  onMove,
  onCancel,
  onMoved,
}: {
  roomId: string;
  node: NodeSummary;
  rootLabel: string;
  onMove: (destinationId: string | null) => Promise<void>;
  onCancel: () => void;
  onMoved: () => void;
}) {
  /** `undefined` is the caller's scope root — the same spelling the browse query uses. */
  const [destination, setDestination] = useState<string | undefined>(undefined);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<Error | null>(null);

  const browse = useBrowse(roomId, destination);
  const page = browse.data?.pages[0];
  const here = page?.node ?? null;
  const folders = (browse.data?.pages ?? [])
    .flatMap((each) => each.children)
    .filter((child) => child.type === 'FOLDER' && child.id !== node.id);

  // Moving something into the folder it is already in is a request whose only outcomes are
  // a no-op and a `409` against the row itself.
  const alreadyHere = (here?.id ?? null) === node.parentId;
  const parentOfHere = page?.breadcrumbs.at(-1)?.id;

  async function handleMove() {
    if (pending) return;
    setPending(true);
    setFailure(null);
    try {
      await onMove(here?.id ?? null);
      onMoved();
    } catch (error) {
      setFailure(error instanceof Error ? error : new Error(String(error)));
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Move &ldquo;{node.name}&rdquo;</DialogTitle>
        <DialogDescription>
          Open a folder to look inside it, then move the file into the folder you are in.
        </DialogDescription>
      </DialogHeader>

      <div className="my-2 space-y-2">
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Up one folder"
            // The trail is clipped to the caller's scope, so this stops at their root
            // rather than climbing towards a folder they may not see.
            disabled={here === null || pending}
            onClick={() => {
              setDestination(parentOfHere);
              setFailure(null);
            }}
          >
            <CornerLeftUp />
          </Button>
          <p className="truncate text-sm font-medium">{here?.name ?? rootLabel}</p>
        </div>

        <div className="h-56 overflow-y-auto rounded-md border">
          {browse.isPending ? (
            <div className="space-y-3 p-3">
              {Array.from({ length: 4 }, (_, index) => (
                <Skeleton key={index} className="h-4 w-full" />
              ))}
            </div>
          ) : browse.isError ? (
            <p className="p-3 text-sm text-destructive">{describeFailure(browse.error)}</p>
          ) : folders.length === 0 ? (
            <p className="p-3 text-sm text-muted-foreground">
              No folders here. Move the file into this one, or go back up.
            </p>
          ) : (
            <ul>
              {folders.map((folder) => (
                <li key={folder.id}>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted"
                    disabled={pending}
                    onClick={() => {
                      setDestination(folder.id);
                      setFailure(null);
                    }}
                  >
                    <Folder className="size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">{folder.name}</span>
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                  </button>
                </li>
              ))}
              {browse.hasNextPage ? (
                <li className="p-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="w-full"
                    disabled={browse.isFetchingNextPage}
                    onClick={() => {
                      void browse.fetchNextPage();
                    }}
                  >
                    {browse.isFetchingNextPage ? 'Loading…' : 'Load more'}
                  </Button>
                </li>
              ) : null}
            </ul>
          )}
        </div>
      </div>

      {failure ? (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {describeFailure(failure)}
        </p>
      ) : null}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        <Button
          type="button"
          disabled={pending || alreadyHere || browse.isError}
          onClick={() => {
            void handleMove();
          }}
        >
          {pending ? 'Moving…' : alreadyHere ? 'Already here' : 'Move here'}
        </Button>
      </DialogFooter>
    </>
  );
}
