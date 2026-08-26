import { useState } from 'react';
import { FolderPlus } from 'lucide-react';
import type { NodeSummary } from '@dr/contracts';

import { Button } from '@/components/ui/button';
import { UploadButton, UploadDropzone, uploadLimitsHint } from '@/features/upload/upload-dropzone';
import { UploadQueuePanel } from '@/features/upload/upload-queue';
import { useUploadQueue } from '@/features/upload/use-upload-queue';
import { useDownload } from '@/features/viewer/use-download';
import { formatBytes, pluralize } from '@/lib/formatters';
import type { NodeSource } from '@/lib/node-source';
import { EmptyFolderState } from './browser-states';
import { DeleteNodeDialog } from './delete-node-dialog';
import { InlineFailure } from './inline-failure';
import { MoveNodeDialog } from './move-node-dialog';
import { NodeBreadcrumbs } from './node-breadcrumbs';
import { NodeNameDialog } from './node-name-dialog';
import { NodeTable } from './node-table';
import {
  useCreateFolder,
  useDeleteNode,
  useMoveNode,
  useRenameNode,
  type BrowseQuery,
} from './use-node-browser';

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
 *
 * The query itself is owned by `NodeView`, which resolves it, renders the loading and error
 * screens, and dispatches on `node.type`: a file id lands on the preview, a folder id here.
 */
export function NodeBrowser({
  source,
  nodeId,
  browse,
  rootLabel,
}: {
  source: NodeSource;
  nodeId?: string;
  browse: BrowseQuery;
  rootLabel: string;
}) {
  const createFolder = useCreateFolder(source, nodeId);
  const renameNode = useRenameNode(source, nodeId);
  const deleteNode = useDeleteNode(source, nodeId);
  const moveNode = useMoveNode(source, nodeId);
  const uploads = useUploadQueue(source, nodeId ?? null);
  // Not behind `canWrite`: downloading is a read, and a `VIEWER` sharing this screen in
  // Phase 4 may save what they can already open.
  const downloads = useDownload(source);

  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<NodeSummary | null>(null);
  const [deleting, setDeleting] = useState<NodeSummary | null>(null);
  const [moving, setMoving] = useState<NodeSummary | null>(null);
  // A drag has nowhere to put an error: the row it started from may already be gone from
  // the listing, and there is no dialog open to hold the message. So a failed drop reports
  // here, once, dismissibly. The dialog keeps its own failure inline.
  const [dragFailure, setDragFailure] = useState<string | null>(null);
  // A download reports through the same banner, for the same reason and by design: Activity
  // deletes this surface and takes both cases with it. Whichever failed last is the one on
  // screen — two stacked banners for two unrelated mishaps is noise, not information.
  const failure = dragFailure ?? downloads.failure;

  const [first] = browse.data?.pages ?? [];
  if (!first) return null;
  const { node, breadcrumbs, role } = first;
  const children = browse.data?.pages.flatMap((page) => page.children) ?? [];

  const canWrite = role === 'OWNER';
  const totals = node ?? first.room ?? null;

  async function moveTo(source: NodeSummary, destinationId: string | null) {
    await moveNode.mutateAsync({ id: source.id, parentId: destinationId });
  }

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6">
      <div className="space-y-2">
        <NodeBreadcrumbs
          source={source}
          rootLabel={rootLabel}
          trail={breadcrumbs}
          current={node?.name ?? null}
        />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">{node?.name ?? rootLabel}</h1>
            {totals ? <p className="text-sm text-muted-foreground">{summarize(totals)}</p> : null}
          </div>
          {canWrite ? (
            <div className="flex items-center gap-2">
              <UploadButton onFiles={uploads.enqueue} />
              <Button
                size="sm"
                onClick={() => {
                  setCreating(true);
                }}
              >
                <FolderPlus />
                New folder
              </Button>
            </div>
          ) : null}
        </div>
      </div>

      {canWrite ? <UploadQueuePanel queue={uploads} /> : null}

      {failure ? (
        <InlineFailure
          message={failure}
          onDismiss={() => {
            setDragFailure(null);
            downloads.dismissFailure();
          }}
        />
      ) : null}

      {/*
        The drop target is the folder's contents rather than a bordered box beside them:
        what a user aims at when dropping documents into a folder is the list they are
        looking at. It is disabled for a reader who cannot write, so the overlay never
        promises an upload the server would refuse (decision #25 — the button is
        presentation; the service still asserts the role).
      */}
      <UploadDropzone onFiles={uploads.enqueue} disabled={!canWrite}>
        {node === null && children.length === 0 ? (
          // At the room root there is no `..` row to offer — `node` is already `null` — so
          // an empty listing has nothing for a table to show at all.
          <EmptyFolderState />
        ) : (
          <NodeTable
            source={source}
            node={node}
            nodes={children}
            canWrite={canWrite}
            onRename={setRenaming}
            onDelete={setDeleting}
            onMove={setMoving}
            downloadingId={downloads.pendingId}
            onDownload={(node) => {
              // The banner holds one message. Clearing the other case here is what keeps
              // "whichever failed last" true rather than "whichever failed first".
              setDragFailure(null);
              downloads.download(node);
            }}
            onDropMove={(source, destination) => {
              setDragFailure(null);
              downloads.dismissFailure();
              moveTo(source, destination.id).catch((error: unknown) => {
                const message = error instanceof Error ? error.message : String(error);
                setDragFailure(
                  `“${source.name}” could not be moved into “${destination.name}”. ${message}`,
                );
              });
            }}
          />
        )}
      </UploadDropzone>

      {canWrite ? <p className="text-xs text-muted-foreground">{uploadLimitsHint()}</p> : null}

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
        // Deliberately silent about suffixes. Upload auto-suffixes because the name came
        // from a file; rename does not, because the user is typing it right now
        // (decision #20). Copy promising an automatic rename here would be a lie about the
        // one path that answers `409`.
        description="Names are unique within a folder, and case is preserved."
        initialName={renaming?.name ?? ''}
        onSubmit={async (name) => {
          if (renaming) await renameNode.mutateAsync({ id: renaming.id, name });
        }}
      />

      <MoveNodeDialog
        source={source}
        node={moving}
        rootLabel={rootLabel}
        open={moving !== null}
        onOpenChange={(open) => {
          if (!open) setMoving(null);
        }}
        onMove={async (destinationId) => {
          if (moving) await moveTo(moving, destinationId);
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
