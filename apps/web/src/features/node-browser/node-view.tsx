import type { NodeType } from '@dr/contracts';

import { Skeleton } from '@/components/ui/skeleton';
import { FilePreview } from '@/features/viewer/file-preview';
import { ErrorState } from '@/features/session/error-state';
import { ApiError } from '@/lib/api-client';
import type { NodeSource } from '@/lib/node-source';
import {
  DeadLinkState,
  DeletedFileState,
  DeletedFolderState,
  NodeNotFoundState,
} from './browser-states';
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
 *
 * **The share surface is this same component rooted differently**, not a second browser.
 * What a `source` changes is the endpoint, the in-app links and the cache key
 * (`node-source.ts`); the response shape, the dispatch and all four states are shared, and
 * `role` arriving as `VIEWER` is what hides every control a visitor may not use.
 */
/**
 * What the row that was clicked believed this node to be, read out of navigation state.
 *
 * It lives beside the component that consumes it rather than in each route, because both
 * node routes — the authenticated one and the share one — hand it the same value, and two
 * copies of a rule about untyped history state is two chances to disagree about it.
 */
export function hintedTypeOf(state: unknown): NodeType | undefined {
  if (typeof state !== 'object' || state === null || !('nodeType' in state)) return undefined;
  const { nodeType } = state;
  return nodeType === 'FILE' || nodeType === 'FOLDER' ? nodeType : undefined;
}

export function NodeView({
  source,
  nodeId,
  hintedType,
}: {
  source: NodeSource;
  nodeId?: string;
  /** What the caller believed this node was: the row they clicked, in navigation state. */
  hintedType?: NodeType;
}) {
  const browse = useBrowse(source, nodeId);
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
      /**
       * **Two different `410`s, told apart by where the reader is standing.**
       *
       * At a share's root the token itself is what failed — revoked, expired, or never
       * issued — and the visitor's answer is that the link is dead. Deeper in, a `410` is
       * the ordinary "the owner deleted this" case and keeps its own screen.
       *
       * The rule is positional rather than read off the response, because it cannot be
       * read off the response: a `410` carries a message and nothing else, and a body
       * naming which of the two it was would be a new field in the contract to serve one
       * sentence. Revoking a link while a visitor is deep inside it therefore shows them
       * the deleted-node screen first, whose action lands on the share root and tells them
       * the truth one click later. An owner is never in this branch: their scope root is
       * the room, which is not a node and cannot be deleted.
       */
      const linkItselfIsDead = source.kind === 'share' && nodeId === undefined;
      return (
        <div className="mx-auto w-full max-w-4xl">
          {linkItselfIsDead ? (
            <DeadLinkState />
          ) : knownType === 'FILE' ? (
            <DeletedFileState source={source} />
          ) : (
            <DeletedFolderState source={source} />
          )}
        </div>
      );
    }
    if (error instanceof ApiError && error.status === 404) {
      return (
        <div className="mx-auto w-full max-w-4xl">
          <NodeNotFoundState source={source} />
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
        source={source}
        node={first.node}
        breadcrumbs={first.breadcrumbs}
        rootLabel={rootLabel}
        canWrite={first.role === 'OWNER'}
      />
    );
  }

  return <NodeBrowser source={source} nodeId={nodeId} browse={browse} rootLabel={rootLabel} />;
}
