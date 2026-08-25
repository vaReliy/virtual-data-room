import { Link } from 'react-router';
import { File, Folder, MoreHorizontal } from 'lucide-react';
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
  nodes,
  canWrite,
  onRename,
  onDelete,
}: {
  roomId: string;
  nodes: NodeSummary[];
  canWrite: boolean;
  onRename: (node: NodeSummary) => void;
  onDelete: (node: NodeSummary) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border">
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
          {nodes.map((node) => (
            <TableRow key={node.id}>
              <TableCell className="font-medium">
                <div className="flex items-center gap-2">
                  {node.type === 'FOLDER' ? (
                    <Folder className="size-4 shrink-0 text-muted-foreground" />
                  ) : (
                    <File className="size-4 shrink-0 text-muted-foreground" />
                  )}
                  {node.type === 'FOLDER' ? (
                    <Link
                      to={`/rooms/${roomId}/n/${node.id}`}
                      className="truncate underline-offset-4 hover:underline"
                    >
                      {node.name}
                    </Link>
                  ) : (
                    // No file can exist in this phase, and a file has no screen to open
                    // until Phase 3 builds the preview. A row that navigates nowhere is
                    // better than a link that looks live and is not.
                    <span className="truncate">{node.name}</span>
                  )}
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
                  Hidden behind `role`, and that is presentation only: the service asserts
                  `scope.role === 'OWNER'` as the first line of every mutation and refuses
                  with `404` (decision #25). `curl` does not read the UI.
                */}
                {canWrite ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" aria-label={`Actions for ${node.name}`}>
                        <MoreHorizontal />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onSelect={() => {
                          onRename(node);
                        }}
                      >
                        Rename
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        variant="destructive"
                        onSelect={() => {
                          onDelete(node);
                        }}
                      >
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : null}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/**
 * The loading state, shaped like the table it replaces. A spinner in the middle of an
 * empty page makes every load look like a layout jump when the rows finally arrive.
 */
export function NodeTableSkeleton() {
  return (
    <div className="rounded-lg border">
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
