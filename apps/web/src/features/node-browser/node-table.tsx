import { useState, type DragEvent } from 'react';
import { Link } from 'react-router';
import { CornerLeftUp, Download, File, Folder, MoreHorizontal } from 'lucide-react';
import type { NodeSummary } from '@dr/contracts';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatBytes, formatTimestamp, pluralize } from '@/lib/formatters';
import { NODE_DRAG_TYPE, carriesNode } from './node-drag';

/**
 * A folder's own subtree totals, on the row.
 *
 * This is the README's scaling answer made visible rather than merely asserted: the
 * numbers are denormalized counters maintained on every mutation (decision #5), so a
 * folder holding ten thousand descendants renders in the same constant work as an empty
 * one. No subtree scan happens anywhere in this request.
 */
function contentsOf(node: NodeSummary): string {
  if (node.type === 'FILE') return '—';
  if (node.fileCount === 0 && node.folderCount === 0) return 'Empty';

  const parts = [];
  if (node.folderCount > 0) parts.push(pluralize(node.folderCount, 'folder'));
  if (node.fileCount > 0) parts.push(pluralize(node.fileCount, 'file'));
  return parts.join(', ');
}

/** A folder's size is its whole subtree's; a file's is its blob's. */
function sizeOf(node: NodeSummary): string {
  return formatBytes(node.type === 'FOLDER' ? node.totalSize : node.size);
}

export function NodeTable({
  roomId,
  node,
  nodes,
  canWrite,
  onRename,
  onDelete,
  onMove,
  onDownload,
  downloadingId,
  onDropMove,
}: {
  roomId: string;
  /** The folder whose children are `nodes` — `null` at the caller's scope root. */
  node: NodeSummary | null;
  nodes: NodeSummary[];
  canWrite: boolean;
  onRename: (node: NodeSummary) => void;
  onDelete: (node: NodeSummary) => void;
  onMove: (node: NodeSummary) => void;
  onDownload: (node: NodeSummary) => void;
  /** The row whose presigned URL is being fetched, if any. */
  downloadingId: string | null;
  onDropMove: (source: NodeSummary, destination: NodeSummary) => void;
}) {
  /**
   * The node being dragged, and the folder row currently under it.
   *
   * The dragged node is held in state rather than read from the `DataTransfer`, because
   * `getData()` is unreadable during `dragover` — the browser's drag protection mode
   * exposes only `types` until the drop. `types` is enough to know *that* a node is being
   * dragged (see `NODE_DRAG_TYPE`); this is how the row also knows *which*, so a folder can
   * refuse to be dropped onto itself.
   */
  const [dragging, setDragging] = useState<NodeSummary | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  /**
   * A folder row accepts a node drop when a node is being dragged and it is not that node.
   *
   * **Only files are draggable in this phase**, so there is no cycle to guard against here
   * — and the server guards it anyway (`422`, not `409`), which is where a guard belongs
   * when `curl` exists.
   */
  function accepts(folder: NodeSummary, event: DragEvent): boolean {
    return (
      canWrite &&
      folder.type === 'FOLDER' &&
      carriesNode(event.dataTransfer) &&
      dragging !== null &&
      dragging.id !== folder.id &&
      // Already there: the move would be a no-op or a `409` against the row itself.
      dragging.parentId !== folder.id
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead className="hidden sm:table-cell">Contents</TableHead>
            <TableHead className="hidden sm:table-cell">Size</TableHead>
            <TableHead className="hidden md:table-cell">Updated</TableHead>
            {/* Not empty for a screen reader: the column holds each row's actions. */}
            <TableHead className="w-10">
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {node ? (
            // Pinned first, outside `nodes.map`: not a node, so no size, date, contents or
            // actions dropdown, and no drag handlers — it must not accidentally satisfy
            // `accepts()`. The destination is `node.parentId`, nulled at the caller's scope
            // root exactly like at the room root, so the row disappears exactly where
            // climbing must stop rather than pointing at a parent the caller cannot see.
            <TableRow>
              <TableCell className="font-medium">
                <div className="flex items-center gap-2">
                  <CornerLeftUp className="size-4 shrink-0 text-muted-foreground" />
                  <Link
                    to={node.parentId ? `/rooms/${roomId}/n/${node.parentId}` : `/rooms/${roomId}`}
                    aria-label="Up one folder"
                    className="text-muted-foreground underline-offset-4 hover:underline"
                  >
                    ..
                  </Link>
                </div>
              </TableCell>
              <TableCell className="hidden sm:table-cell" />
              <TableCell className="hidden sm:table-cell" />
              <TableCell className="hidden md:table-cell" />
              <TableCell />
            </TableRow>
          ) : null}
          {nodes.map((node) => {
            // Files only. A folder-move UI is out of scope for this phase — the endpoint is
            // type-agnostic and would serve it, but `BRIEF.md` asks for moving a file and
            // the cycle guard is covered by a test rather than by a screen.
            const draggable = canWrite && node.type === 'FILE';
            return (
              <TableRow
                key={node.id}
                draggable={draggable}
                onDragStart={
                  draggable
                    ? (event) => {
                        event.dataTransfer.setData(NODE_DRAG_TYPE, node.id);
                        event.dataTransfer.effectAllowed = 'move';
                        setDragging(node);
                      }
                    : undefined
                }
                onDragEnd={() => {
                  setDragging(null);
                  setDropTarget(null);
                }}
                onDragOver={(event) => {
                  if (!accepts(node, event)) return;
                  // Without `preventDefault` on *both* dragover and drop the browser
                  // treats the row as not a drop target at all, and the drag snaps back.
                  event.preventDefault();
                  event.dataTransfer.dropEffect = 'move';
                  setDropTarget(node.id);
                }}
                onDragLeave={() => {
                  setDropTarget((current) => (current === node.id ? null : current));
                }}
                onDrop={(event) => {
                  if (!accepts(node, event)) return;
                  event.preventDefault();
                  const source = dragging;
                  setDropTarget(null);
                  setDragging(null);
                  if (source) onDropMove(source, node);
                }}
                className={
                  dropTarget === node.id
                    ? 'bg-primary/10 outline outline-2 -outline-offset-2 outline-primary'
                    : dragging?.id === node.id
                      ? 'opacity-50'
                      : undefined
                }
              >
                <TableCell className="font-medium">
                  <div className="flex items-center gap-2">
                    {node.type === 'FOLDER' ? (
                      <Folder className="size-4 shrink-0 text-muted-foreground" />
                    ) : (
                      <File className="size-4 shrink-0 text-muted-foreground" />
                    )}
                    <Link
                      to={`/rooms/${roomId}/n/${node.id}`}
                      // The row already knows what it is, and the `410` body does not carry
                      // a type. Handing the type along in navigation state is what lets the
                      // preview show "this file was deleted" instead of the folder wording
                      // when the reader clicks a row that has just gone.
                      state={{ nodeType: node.type }}
                      // An anchor is draggable by default and would start a *link* drag —
                      // a URL, not a node — from the one part of the row a user is most
                      // likely to grab. Refusing it here hands the drag to the row.
                      draggable={false}
                      className="truncate underline-offset-4 hover:underline"
                    >
                      {node.name}
                    </Link>
                  </div>
                </TableCell>
                <TableCell className="hidden text-muted-foreground sm:table-cell">
                  {contentsOf(node)}
                </TableCell>
                <TableCell className="hidden text-muted-foreground tabular-nums sm:table-cell">
                  {sizeOf(node)}
                </TableCell>
                <TableCell className="hidden text-muted-foreground md:table-cell">
                  {formatTimestamp(node.updatedAt)}
                </TableCell>
                <TableCell>
                  {/*
                    The mutations are hidden behind `role`, and that is presentation only:
                    the service asserts `scope.role === 'OWNER'` as the first line of every
                    mutation and refuses with `404` (decision #25). `curl` does not read the
                    UI.

                    The menu itself is not behind `role`, because Download is not a
                    mutation. A `VIEWER` gets a menu holding that one item — hiding it would
                    be the only thing standing between them and bytes the preview already
                    serves them.
                  */}
                  {canWrite || node.type === 'FILE' ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" aria-label={`Actions for ${node.name}`}>
                          <MoreHorizontal />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {/*
                          Files only: a folder has no blob and the endpoint answers `422`
                          for one. There is no zip-a-folder feature to offer here.
                        */}
                        {node.type === 'FILE' ? (
                          <DropdownMenuItem
                            disabled={downloadingId === node.id}
                            onSelect={() => {
                              onDownload(node);
                            }}
                          >
                            <Download />
                            {downloadingId === node.id ? 'Preparing…' : 'Download'}
                          </DropdownMenuItem>
                        ) : null}
                        {canWrite ? (
                          <DropdownMenuItem
                            onSelect={() => {
                              onRename(node);
                            }}
                          >
                            Rename
                          </DropdownMenuItem>
                        ) : null}
                        {/*
                          The primary move affordance (decision #19): reachable by keyboard,
                          announced by a screen reader, and the one that satisfies the brief
                          on its own. Dragging the row is the convenience on top of it.
                        */}
                        {canWrite && node.type === 'FILE' ? (
                          <DropdownMenuItem
                            onSelect={() => {
                              onMove(node);
                            }}
                          >
                            Move to…
                          </DropdownMenuItem>
                        ) : null}
                        {canWrite ? (
                          <DropdownMenuItem
                            variant="destructive"
                            onSelect={() => {
                              onDelete(node);
                            }}
                          >
                            Delete
                          </DropdownMenuItem>
                        ) : null}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : null}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      {nodes.length === 0 ? (
        // Outside the table, not a `colSpan` row: the `..` row above stays pinned at its
        // natural height, and this message is free to grow with `flex-1` and centre in
        // whatever height that leaves — the same treatment `EmptyFolderState` gives the
        // room root, so the two read as one message rather than two different heights of
        // "nothing here" depending on how deep the caller is. Room root reaches this only
        // through the `node === null` branch in `NodeBrowser`, which renders
        // `EmptyFolderState` instead of this table, so this message never appears without
        // the `..` row above it.
        <div className="flex flex-1 items-center justify-center p-4 text-center text-sm text-muted-foreground">
          This folder is empty.
        </div>
      ) : null}
    </div>
  );
}

/**
 * The loading state, shaped like the table it replaces. A spinner in the middle of an
 * empty page makes every load look like a layout jump when the rows finally arrive.
 */
export function NodeTableSkeleton() {
  return (
    <div className="flex min-h-(--browser-frame-min-height) flex-col justify-center rounded-lg border">
      <div className="space-y-4 p-4">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} className="flex items-center gap-3">
            <Skeleton className="size-4 shrink-0 rounded" />
            <Skeleton className="h-4 flex-1" />
            <Skeleton className="hidden h-4 w-24 sm:block" />
            <Skeleton className="hidden h-4 w-16 sm:block" />
          </div>
        ))}
      </div>
    </div>
  );
}
