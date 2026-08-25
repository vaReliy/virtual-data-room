import { useState } from 'react';
import { FolderPlus } from 'lucide-react';
import type { NodeSummary } from '@dr/contracts';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/features/session/error-state';
import { ApiError } from '@/lib/api-client';
import { formatBytes, pluralize } from '@/lib/formatters';
import { DeletedFolderState, EmptyFolderState, NodeNotFoundState } from './browser-states';
import { DeleteNodeDialog } from './delete-node-dialog';
import { NodeBreadcrumbs } from './node-breadcrumbs';
import { NodeNameDialog } from './node-name-dialog';
import { NodeTable, NodeTableSkeleton } from './node-table';
import { useBrowse, useCreateFolder, useDeleteNode, useRenameNode } from './use-node-browser';

/** The subtree totals of whatever is currently on screen, as one line under the title. */
function summarize(totals: { folderCount: number; fileCount: number; totalSize: number }): string {
  return [
    pluralize(totals.folderCount, 'folder'),
    pluralize(totals.fileCount, 'file'),
    formatBytes(totals.totalSize),
  ].join(' · ');
}

/**
 * The folder browser: one component for the room root and for every folder inside it,
 * because the API answers both with the same shape (decision #24) — `node: null` and an
 * empty breadcrumb trail simply mean "the caller's scope root".
 *
 * **It never decides what exists.** There is deliberately no `dataRooms.find(...)` gate
 * here: `GET /api/me` lists the rooms the caller *owns*, not the rooms they can *reach*,
 * so deriving existence from it would 404 a valid `USER`-share recipient in the client
 * before the API was ever asked. The route asks the browse endpoint and renders whatever
 * it answers — including its `404`.
 */
export function NodeBrowser({ roomId, nodeId }: { roomId: string; nodeId?: string }) {
  const browse = useBrowse(roomId, nodeId);
  const createFolder = useCreateFolder(roomId, nodeId);
  const renameNode = useRenameNode(roomId, nodeId);
  const deleteNode = useDeleteNode(roomId, nodeId);

  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<NodeSummary | null>(null);
  const [deleting, setDeleting] = useState<NodeSummary | null>(null);

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
    // Four states, four screens. Collapsing any two of them into a generic failure is
    // the mistake the error contract exists to prevent.
    if (error instanceof ApiError && error.status === 410) {
      return (
        <div className="mx-auto w-full max-w-4xl">
          <DeletedFolderState roomId={roomId} />
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
  const { room, node, breadcrumbs, role } = first;
  const children = browse.data.pages.flatMap((page) => page.children);

  const canWrite = role === 'OWNER';
  // `room` is absent exactly when the room's name sits above the caller's scope root.
  const rootLabel = room?.name ?? 'Shared folder';
  const totals = node ?? room ?? null;

  const newFolderButton = canWrite ? (
    <Button
      size="sm"
      onClick={() => {
        setCreating(true);
      }}
    >
      <FolderPlus />
      New folder
    </Button>
  ) : null;

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6">
      <div className="space-y-2">
        <NodeBreadcrumbs
          roomId={roomId}
          rootLabel={rootLabel}
          trail={breadcrumbs}
          current={node?.name ?? null}
        />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">{node?.name ?? rootLabel}</h1>
            {totals ? <p className="text-sm text-muted-foreground">{summarize(totals)}</p> : null}
          </div>
          {newFolderButton}
        </div>
      </div>

      {children.length === 0 ? (
        <EmptyFolderState />
      ) : (
        <NodeTable
          roomId={roomId}
          nodes={children}
          canWrite={canWrite}
          onRename={setRenaming}
          onDelete={setDeleting}
        />
      )}

      {browse.hasNextPage ? (
        <div className="flex justify-center">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              void browse.fetchNextPage();
            }}
            disabled={browse.isFetchingNextPage}
          >
            {browse.isFetchingNextPage ? 'Loading…' : 'Load more'}
          </Button>
        </div>
      ) : null}

      <NodeNameDialog
        open={creating}
        onOpenChange={setCreating}
        submitLabel="Create folder"
        description={`A new folder inside “${node?.name ?? rootLabel}”.`}
        onSubmit={async (name) => {
          await createFolder.mutateAsync(name);
        }}
      />

      <NodeNameDialog
        // Remounts on a different row, so the field starts from that row's name rather
        // than the previous one's.
        key={renaming?.id ?? 'rename'}
        open={renaming !== null}
        onOpenChange={(open) => {
          if (!open) setRenaming(null);
        }}
        submitLabel="Rename"
        description="Names are unique within a folder, and case is preserved."
        initialName={renaming?.name ?? ''}
        onSubmit={async (name) => {
          if (renaming) await renameNode.mutateAsync({ id: renaming.id, name });
        }}
      />

      <DeleteNodeDialog
        node={deleting}
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        onConfirm={async (id) => {
          await deleteNode.mutateAsync(id);
        }}
      />
    </div>
  );
}
