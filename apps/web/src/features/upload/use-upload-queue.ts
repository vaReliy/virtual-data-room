import { useCallback, useRef, useState } from 'react';
import {
  MAX_FILE_SIZE_BYTES,
  MAX_PRESIGN_BATCH,
  UPLOAD_MIME_TYPE,
  nodeNameSchema,
  nodeSummarySchema,
  presignUploadResponseSchema,
  type PresignedUpload,
} from '@dr/contracts';
import { useQueryClient } from '@tanstack/react-query';

import { ApiError, NetworkError, apiSend } from '@/lib/api-client';
import { uploadPath, type NodeSource } from '@/lib/node-source';
import { queryKeys } from '@/lib/query-keys';
import { TransferCancelled, TransferError, putObject } from './put-object';

/**
 * The five states a queued file can be in, and all five are part of the feature. A queue
 * that only renders "uploading" is the same queue with four of its outcomes hidden.
 *
 * `cancelled` is deliberately not `error`: nothing went wrong, the user asked for it, and
 * a red row would ask them to fix something they chose.
 */
export type UploadStatus = 'pending' | 'uploading' | 'error' | 'cancelled' | 'complete';

export interface UploadItem {
  readonly id: string;
  readonly file: File;
  /** The trimmed name `nodeNameSchema` accepted, which is what both API calls are sent. */
  readonly name: string;
  readonly size: number;
  readonly status: UploadStatus;
  /** `0`–`1`, meaningful while `uploading`. */
  readonly progress: number;
  readonly error: string | null;
}

/**
 * The client-side half of the limits, run **before** presign — every one of them read from
 * `@dr/contracts` rather than written again here. A second copy of "10 MB" in the web app
 * is exactly how the two drift, and the drift is invisible until a file the dropzone
 * accepted comes back `422` from the server.
 *
 * A rejected file still joins the queue, as an `error` row. Dropping it silently would
 * leave the user with a dropzone that ignored half of what they gave it and no reason why.
 */
function screen(file: File): { name: string } | { reason: string } {
  const name = nodeNameSchema.safeParse(file.name);
  if (!name.success) {
    return { reason: name.error.issues[0]?.message ?? 'This file name cannot be used.' };
  }
  // `File.type` comes from the OS, so an extension-less PDF can arrive as `''`. That is
  // still a refusal: the type is signed into the upload URL and re-checked by `HEAD` at
  // complete, so accepting it here would only move the failure later.
  if (file.type !== UPLOAD_MIME_TYPE) return { reason: 'Only PDF files can be uploaded.' };
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return { reason: `This file is larger than ${describeMegabytes(MAX_FILE_SIZE_BYTES)}.` };
  }
  return { name: name.data };
}

export function describeMegabytes(bytes: number): string {
  return `${String(Math.round(bytes / (1024 * 1024)))} MB`;
}

/**
 * A failed step, as one line on the row. The statuses are not collapsed into "upload
 * failed" because they are four different situations with four different remedies —
 * which is the whole reason the error contract spends distinct codes on them.
 */
function describeFailure(error: unknown): string {
  if (error instanceof NetworkError) return 'The server could not be reached.';
  if (error instanceof TransferError) return error.message;
  if (error instanceof ApiError) {
    // `429` gets a plain row and **no automatic retry**. Twenty presigns a minute at ten
    // files each is two hundred files, which no one dragging documents into a browser
    // reaches — so hitting it means something is wrong, and a silent retry would hide it.
    if (error.status === 429) return 'Too many uploads at once. Wait a minute and try again.';
    if (error.status === 410) return 'The folder this file was going into was deleted.';
    if (error.status === 404) return 'This folder no longer exists.';
    // `422` (wrong type, too large, over quota) and `409` (the same name four times over,
    // past the auto-suffix bound) both carry a specific server-written reason.
    return error.message;
  }
  return error instanceof Error ? error.message : 'The upload failed.';
}

/** Presign takes at most ten files, so a larger drop becomes several batches. */
function chunk<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

export interface UploadQueue {
  items: UploadItem[];
  enqueue: (files: File[]) => void;
  cancel: (id: string) => void;
  clearFinished: () => void;
}

/**
 * The upload queue: the only genuinely client-side state in this app.
 *
 * It runs the three-step protocol (decision #28) for one folder — presign a batch, `PUT`
 * each file's bytes straight to storage, complete each file on its own — and it holds
 * exactly what the rows render. Nothing here is server state, so none of it belongs in
 * TanStack Query; what *is* server state, the folder listing, is invalidated as each file
 * lands.
 *
 * **Transfers run one at a time.** The whole batch is signed at a single moment and each
 * URL lives 900 seconds, so ten parallel transfers on a slow uplink would share the
 * bandwidth and race the same deadline together; sequential ones let early files land
 * while later ones still have time.
 *
 * **A cancelled or abandoned transfer leaves a `PENDING` blob that nothing collects.** That
 * is known and accepted — the sweeper is Phase 6 README prose — and it is why cancelling
 * before presign, which reserves nothing, is preferred wherever the queue can manage it.
 */
export function useUploadQueue(source: NodeSource, parentId: string | null): UploadQueue {
  const queryClient = useQueryClient();
  const [items, setItems] = useState<UploadItem[]>([]);
  // Not state: aborting is an imperative act on an in-flight request, and re-rendering
  // because a controller was created would be noise. One per item, so cancel is per file.
  const controllers = useRef(new Map<string, AbortController>());

  const patch = useCallback((id: string, changes: Partial<UploadItem>) => {
    setItems((previous) =>
      previous.map((item) => (item.id === id ? { ...item, ...changes } : item)),
    );
  }, []);

  /**
   * A final state, and the controller that will never be needed again. The two go together
   * so that a long session of drops does not accumulate one `AbortController` per file that
   * finished minutes ago.
   */
  const settle = useCallback(
    (id: string, changes: Partial<UploadItem>) => {
      controllers.current.delete(id);
      patch(id, changes);
    },
    [patch],
  );

  const enqueue = useCallback(
    (files: File[]) => {
      if (files.length === 0) return;

      const accepted: UploadItem[] = [];
      const created: UploadItem[] = [];

      for (const file of files) {
        const id = crypto.randomUUID();
        const screened = screen(file);
        const item: UploadItem =
          'reason' in screened
            ? {
                id,
                file,
                name: file.name,
                size: file.size,
                status: 'error',
                progress: 0,
                error: screened.reason,
              }
            : {
                id,
                file,
                name: screened.name,
                size: file.size,
                status: 'pending',
                progress: 0,
                error: null,
              };
        created.push(item);
        if (item.status === 'pending') {
          controllers.current.set(id, new AbortController());
          accepted.push(item);
        }
      }

      setItems((previous) => [...previous, ...created]);
      if (accepted.length > 0) void run(accepted);

      async function run(queued: UploadItem[]) {
        for (const batch of chunk(queued, MAX_PRESIGN_BATCH)) {
          // Cancelled-while-pending files are dropped before presign rather than after:
          // a blob that is never reserved is a blob no sweeper has to collect.
          const live = batch.filter((item) => !controllers.current.get(item.id)?.signal.aborted);
          for (const item of batch) {
            if (!live.includes(item)) settle(item.id, { status: 'cancelled' });
          }
          if (live.length === 0) continue;

          let presigned;
          try {
            presigned = await apiSend(
              uploadPath(source, 'presign'),
              presignUploadResponseSchema,
              'POST',
              {
                parentId,
                files: live.map((item) => ({
                  name: item.name,
                  size: item.size,
                  mimeType: UPLOAD_MIME_TYPE,
                })),
              },
            );
          } catch (error) {
            // Presign is set-level: one `422` for the quota, one `429` for the rate limit,
            // one `410` for a deleted parent. Every file in the batch failed, and each row
            // says so on its own rather than a banner saying it once.
            const reason = describeFailure(error);
            for (const item of live) settle(item.id, { status: 'error', error: reason });
            continue;
          }

          // The response mirrors the request, one entry per file in the same order — the
          // only correspondence there is, since a blob carries no name.
          for (const [index, item] of live.entries()) {
            const target = presigned.files[index];
            if (!target) {
              settle(item.id, { status: 'error', error: 'The upload could not be prepared.' });
              continue;
            }
            await transfer(item, target);
          }
        }
      }

      async function transfer(item: UploadItem, target: PresignedUpload) {
        const controller = controllers.current.get(item.id);
        if (!controller || controller.signal.aborted) {
          settle(item.id, { status: 'cancelled' });
          return;
        }

        patch(item.id, { status: 'uploading', progress: 0 });
        try {
          await putObject({
            url: target.uploadUrl,
            file: item.file,
            contentType: UPLOAD_MIME_TYPE,
            signal: controller.signal,
            onProgress: (fraction) => {
              patch(item.id, { progress: fraction });
            },
          });
        } catch (error) {
          settle(
            item.id,
            error instanceof TransferCancelled
              ? { status: 'cancelled', progress: 0 }
              : { status: 'error', error: describeFailure(error) },
          );
          return;
        }

        // Past this point cancelling is refused, and the button is disabled to match: the
        // bytes are in storage, so a row claiming the upload was stopped would be a lie
        // one call away from a file existing anyway.
        try {
          await apiSend(uploadPath(source, 'complete'), nodeSummarySchema, 'POST', {
            blobId: target.blobId,
            parentId,
            name: item.name,
          });
          settle(item.id, { status: 'complete', progress: 1, error: null });
          // Per file, not per batch: each one lands at its own moment, and the row
          // appearing in the table as its progress bar finishes is the point.
          await queryClient.invalidateQueries({
            queryKey: queryKeys.browse(source, parentId ?? undefined),
          });
        } catch (error) {
          settle(item.id, { status: 'error', error: describeFailure(error) });
        }
      }
    },
    [source, parentId, patch, settle, queryClient],
  );

  const cancel = useCallback(
    (id: string) => {
      controllers.current.get(id)?.abort();
      // A file that has not started has no request to abort, so its row is settled here.
      // One that is uploading settles in `transfer`, when `xhr.abort()` reports back.
      setItems((previous) =>
        previous.map((item) =>
          item.id === id && item.status === 'pending' ? { ...item, status: 'cancelled' } : item,
        ),
      );
    },
    [setItems],
  );

  const clearFinished = useCallback(() => {
    setItems((previous) =>
      previous.filter((item) => item.status === 'pending' || item.status === 'uploading'),
    );
  }, []);

  return { items, enqueue, cancel, clearFinished };
}
