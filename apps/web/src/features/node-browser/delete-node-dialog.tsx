import { useState } from 'react';
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
import { ApiError, NetworkError } from '@/lib/api-client';
import { formatBytes, pluralize } from '@/lib/formatters';

/**
 * What is about to be lost **inside a folder**, in the numbers the row already carries.
 *
 * These are the denormalized subtree aggregates maintained on every mutation
 * (decision #5), not a count of the visible children — deleting a folder deletes its
 * whole subtree, and a warning that counted only one level would understate it by
 * however deep the tree goes. They cost nothing to read, which is why the warning can be
 * rendered *before* the request rather than reported after it.
 *
 * A file returns `null` and gets its own sentence below. It has nothing inside it, and the
 * folder wording — "this also deletes everything inside it — 585 B" — reads as nonsense on
 * one document. That only became visible when there were files to delete: Phase 2 built
 * this dialog with no file in the system to point it at.
 */
function describeContents(node: NodeSummary): string | null {
  if (node.type === 'FILE') return null;
  if (node.fileCount === 0 && node.folderCount === 0) return null;

  const parts = [];
  if (node.folderCount > 0) parts.push(pluralize(node.folderCount, 'folder'));
  if (node.fileCount > 0) parts.push(pluralize(node.fileCount, 'file'));
  const counted = parts.join(' and ');
  return node.totalSize > 0 ? `${counted} (${formatBytes(node.totalSize)})` : counted;
}

function describeFailure(error: Error): string {
  if (error instanceof NetworkError) {
    return 'The server could not be reached. Check your connection.';
  }
  if (error instanceof ApiError) {
    // Someone else deleted it first. The outcome the user wanted already holds, so this
    // reads as information rather than as a failure they have to act on.
    if (error.status === 410) return 'This item was already deleted.';
    if (error.status === 404) return 'This item no longer exists.';
    return error.message;
  }
  return error.message;
}

/**
 * The delete warning. There is no trash and no restore (decision #6), so this dialog is
 * the only thing standing between a click and permanent-looking loss — which is why it
 * names what goes rather than asking a generic "are you sure?".
 */
export function DeleteNodeDialog({
  node,
  open,
  onOpenChange,
  onConfirm,
}: {
  node: NodeSummary | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (id: string) => Promise<void>;
}) {
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<Error | null>(null);

  if (!node) return null;
  const contents = describeContents(node);

  async function handleConfirm() {
    if (!node || pending) return;
    setPending(true);
    setFailure(null);
    try {
      await onConfirm(node.id);
      onOpenChange(false);
    } catch (error) {
      setFailure(error instanceof Error ? error : new Error(String(error)));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setFailure(null);
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Delete &ldquo;{node.name}&rdquo;?</DialogTitle>
          <DialogDescription>
            {contents
              ? `This also deletes everything inside it — ${contents}. This cannot be undone.`
              : node.type === 'FILE'
                ? `This file is ${formatBytes(node.size)}. This cannot be undone.`
                : 'This cannot be undone.'}
          </DialogDescription>
        </DialogHeader>

        {failure ? (
          <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {describeFailure(failure)}
          </p>
        ) : null}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              onOpenChange(false);
            }}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={() => {
              void handleConfirm();
            }}
            disabled={pending}
          >
            {pending ? 'Deleting…' : 'Delete'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
