import { z } from 'zod';
import { nodeNameSchema } from './node';
import { byteSizeSchema, uuidSchema } from './primitives';

/**
 * The four upload limits, shared by both apps.
 *
 * They existed only as prose in `architecture.md` until this phase. They live beside the
 * schemas for the same reason `nodeNameSchema` does: the dropzone must reject an oversized
 * file *before* presign, and a second hand-written copy of the numbers in the web app is
 * how the two drift apart.
 *
 * The quota is a constant rather than an environment variable — it never differs by
 * environment here, and the README states it as an answer.
 */
export const UPLOAD_MIME_TYPE = 'application/pdf';
export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
export const MAX_PRESIGN_BATCH = 10;
export const DATA_ROOM_QUOTA_BYTES = 200 * 1024 * 1024;

/**
 * How long a presigned GET lives. Five minutes, and the number is load-bearing rather
 * than a default: a preview URL that leaks — pasted into a chat, kept in a browser history
 * — must stop working, and it grants read access to a document with no session behind it.
 */
export const CONTENT_URL_TTL_SECONDS = 300;

/**
 * One file in a presign batch, as the client describes it *before* the bytes exist.
 *
 * Every number here is a claim, not a fact. The authoritative size and content type are
 * read back from storage with a `HEAD` at complete, because these feed the Data Room
 * aggregates and a client that lies about them would corrupt the quota.
 */
export const presignFileSchema = z.object({
  name: nodeNameSchema,
  size: byteSizeSchema.max(
    MAX_FILE_SIZE_BYTES,
    `A file may be at most ${MAX_FILE_SIZE_BYTES / (1024 * 1024)} MB.`,
  ),
  mimeType: z.literal(UPLOAD_MIME_TYPE, 'Only PDF files can be uploaded.'),
});
export type PresignFile = z.infer<typeof presignFileSchema>;

/**
 * `POST /api/rooms/:roomId/uploads/presign` — a batch.
 *
 * The batch is not a convenience: every check this endpoint runs is *set-level*. `≤ 10
 * files` constrains the set, and the quota compares the batch's summed size against what
 * the room has left — ten 30 MB files pass individually and fail together (decision #28).
 *
 * `parentId: null` means the caller's scope root.
 */
export const presignUploadBodySchema = z.object({
  parentId: uuidSchema.nullable(),
  files: z
    .array(presignFileSchema)
    .min(1, 'Select at least one file.')
    .max(MAX_PRESIGN_BATCH, `At most ${MAX_PRESIGN_BATCH} files can be uploaded at once.`),
});
export type PresignUploadBody = z.infer<typeof presignUploadBodySchema>;

/**
 * What the browser needs per file, and deliberately nothing else.
 *
 * No `name` and no `expiresAt`: the client already holds the `File` it asked about, in the
 * order it asked, and an expiry it does not act on is a field that will eventually be
 * trusted. The URL carries its own expiry and storage enforces it.
 */
export const presignedUploadSchema = z.object({
  blobId: uuidSchema,
  uploadUrl: z.url(),
});
export type PresignedUpload = z.infer<typeof presignedUploadSchema>;

/** Mirrors the request body: one entry per requested file, in the same order. */
export const presignUploadResponseSchema = z.object({
  files: z.array(presignedUploadSchema),
});
export type PresignUploadResponse = z.infer<typeof presignUploadResponseSchema>;

/**
 * `POST /api/rooms/:roomId/uploads/complete` — **one file, not a batch**.
 *
 * The asymmetry with presign is deliberate (decision #28). Complete has no set-level check
 * at all: each file carries its own `HEAD`, its own blob and its own name conflict, and
 * each lands at its own moment, which is what per-file progress needs. Batching it would
 * push a per-file `422` out of the HTTP status and into an envelope, and would inflate the
 * auto-suffix retry unit from one row to twenty.
 *
 * `name` travels again rather than being remembered from presign: the blob carries no name
 * — `storageKey` is `${dataRoomId}/${blobId}`, no name and no extension — and the file a
 * user dropped may have been renamed in the queue before it finished uploading.
 */
export const completeUploadBodySchema = z.object({
  blobId: uuidSchema,
  parentId: uuidSchema.nullable(),
  name: nodeNameSchema,
});
export type CompleteUploadBody = z.infer<typeof completeUploadBodySchema>;

/**
 * `GET /api/rooms/:roomId/nodes/:nodeId/content` — a short-lived presigned GET, as JSON.
 *
 * Not a `302`. A redirect would need `Cache-Control: no-store` on itself to avoid
 * recreating the stale-cache bug decision #15 guards against, one level further down where
 * it is harder to see.
 *
 * `expiresAt` is here — unlike on the presign response — because the client acts on it:
 * the preview refetches rather than rendering a dead `<iframe>`.
 */
export const contentUrlResponseSchema = z.object({
  url: z.url(),
  expiresAt: z.iso.datetime(),
});
export type ContentUrlResponse = z.infer<typeof contentUrlResponseSchema>;
