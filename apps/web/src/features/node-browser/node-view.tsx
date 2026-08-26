import type { NodeType } from '@dr/contracts';

import { Skeleton } from '@/components/ui/skeleton';
import { FilePreview } from '@/features/viewer/file-preview';
import { ErrorState } from '@/features/session/error-state';
import { ApiError } from '@/lib/api-client';
import { DeletedFileState, DeletedFolderState, NodeNotFoundState } from './browser-states';
import { NodeBrowser } from './node-browser';
import { NodeTableSkeleton } from './node-table';
import { useBrowse } from './use-node-browser';

/**
 * One location, whichever kind of node it turns out to be.
 *
 * **There is no file route.** `GET /nodes/:id` already answers for a file id — the node
 * resolves, `children` comes back empty and the breadcrumbs are correct — so
 * `/rooms/:roomId/n/:nodeId` serves both types and the dispatch happens here, on
 * `node.type`, after the response arrives. A second route would mean the client deciding
 * what kind of node an id names *before* asking, which it cannot know.
 *
 * This component owns the four states — loading, error, `404`, `410` — so that the folder
 * screen and the preview do not each implement them differently.
 */
export function NodeView({
  roomId,
  nodeId,
  hintedType,
}: {
  roomId: string;
  nodeId?: string;
  /** What the caller believed this node was: the row they clicked, in navigation state. */
  hintedType?: NodeType;
}) {
  const browse = useBrowse(roomId, nodeId);
  const loadedType = browse.data?.pages[0]?.node?.type;

  /**
   * What this id was *known* to be, which is the only way the file `410` screen is ever
   * reachable: a `410` body carries a message and no node, so once the node is gone the
   * response cannot say what kind of thing it was.
   *
   * Two ways in, both of them the reader having held the answer before the node died, and
   * neither of them state this component has to keep:
   *
   * - `browse.data` survives a failed *refetch* — TanStack keeps the last success beside
   *   the error — so a file deleted while it was being previewed still knows it was a file.
   * - `hintedType` is what the table put in navigation state when the row was clicked, for
   *   a row that has already gone by the time it is followed. It is only a hint: on a key
   *   that has ever loaded, the response wins.
   *
   * Navigation state lives on the history entry, so **reloading** that entry keeps the hint
   * (verified in a browser). What has neither source is a link arriving from outside the
   * app — pasted, bookmarked, followed from a mail — and that falls back to the folder
   * wording, which is why that stays the general case rather than a second special case.
   */
  const knownType = loadedType ?? hintedType;

  if (browse.isPending) {
    return (
      <div className="mx-auto w-full max-w-4xl space-y-6">
        <div className="space-y-2">
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-7 w-64" />
          <Skeleton className="h-4 w-56" />
        </div>
        <NodeTableSkeleton />
      </div>
    );
  }

  if (browse.isError) {
    const { error } = browse;
    // Four states, four screens. Collapsing any two of them into a generic failure is the
    // mistake the error contract exists to prevent.
    if (error instanceof ApiError && error.status === 410) {
      return (
        <div className="mx-auto w-full max-w-4xl">
          {knownType === 'FILE' ? (
            <DeletedFileState roomId={roomId} />
          ) : (
            <DeletedFolderState roomId={roomId} />
          )}
        </div>
      );
    }
    if (error instanceof ApiError && error.status === 404) {
      return (
        <div className="mx-auto w-full max-w-4xl">
          <NodeNotFoundState roomId={roomId} />
        </div>
      );
    }
    return (
      <div className="mx-auto w-full max-w-4xl">
        <ErrorState
          error={error}
          onRetry={() => {
            void browse.refetch();
          }}
        />
      </div>
    );
  }

  // `room`, `node` and `breadcrumbs` describe the location, so every page repeats them;
  // only `children` accumulates.
  const [first] = browse.data.pages;
  if (!first) return null;

  // `room` is absent exactly when the room's name sits above the caller's scope root.
  const rootLabel = first.room?.name ?? 'Shared folder';

  if (first.node?.type === 'FILE') {
    return (
      <FilePreview
        roomId={roomId}
        node={first.node}
        breadcrumbs={first.breadcrumbs}
        rootLabel={rootLabel}
      />
    );
  }

  return <NodeBrowser roomId={roomId} nodeId={nodeId} browse={browse} rootLabel={rootLabel} />;
}
