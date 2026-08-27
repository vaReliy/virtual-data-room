import { GoneException, Injectable, NotFoundException } from '@nestjs/common';
import { ConflictException, UnprocessableEntityException } from '@nestjs/common';
import {
  DATA_ROOM_QUOTA_BYTES,
  MAX_FILE_SIZE_BYTES,
  UPLOAD_MIME_TYPE,
  type CompleteUploadBody,
  type NodeSummary,
  type PresignUploadBody,
  type PresignUploadResponse,
} from '@dr/contracts';

import type { AccessScope } from '../../access/access-scope';
import { TransactionRunner } from '../../persistence/transaction.runner';
import { StorageService, type StoredObject } from '../../storage/storage.service';
import { DataRoomRepository } from '../data-room/data-room.repository';
import { isUniqueViolation, NodeRepository, type NodeRecord } from '../node/node.repository';
import { NodeService } from '../node/node.service';
import { BlobRepository, type BlobRecord } from './blob.repository';

/**
 * How many times the whole transaction is re-run on a name collision before the upload is
 * refused. Three, and the bound is **visible in behaviour**: a folder already holding
 * `contract.pdf`, `contract (1).pdf` and `contract (2).pdf` answers `409` on the fourth
 * drop of that name. Correct per decision #20 — an unbounded suffix walk turns one slow
 * folder into an unbounded number of transactions.
 */
const AUTO_SUFFIX_ATTEMPTS = 3;

/** The name length `nodeNameSchema` allows, which the auto-suffix must not push past. */
const MAX_NAME_LENGTH = 255;

/**
 * The upload protocol: presign, then complete (decision #28).
 *
 * It is a protocol rather than a request because a `FILE` cannot exist without a `READY`
 * blob, so it spans two entities and two round trips with the browser's `PUT` to storage in
 * between. Both endpoints sit under the room, because `AccessControlService.resolveForUser`
 * needs a room id and `parentId: null` — a drop at the room root — cannot supply one.
 */
@Injectable()
export class UploadService {
  constructor(
    private readonly blobs: BlobRepository,
    private readonly nodes: NodeRepository,
    private readonly nodeService: NodeService,
    private readonly dataRooms: DataRoomRepository,
    private readonly storage: StorageService,
    private readonly transactions: TransactionRunner,
  ) {}

  /**
   * Reserves blobs for a batch and hands back one presigned `PUT` per file.
   *
   * **The batch is the point.** Every check here is set-level: `≤ 10 files` constrains the
   * set (enforced by the schema), and the quota compares the batch's *summed* size against
   * what the room has left — ten 30 MB files pass individually and fail together.
   *
   * This quota check is **advisory**. It gives the dropzone fast feedback before a single
   * byte moves; the authoritative one runs inside the locked transaction at complete,
   * minutes later, when other uploads may have landed in between.
   *
   * No blob is charged to the room here. A `PENDING` blob belongs to no room until a node
   * points at it, so a batch that is presigned and abandoned costs the quota nothing — it
   * leaves unreferenced bytes that only a sweeper collects (Phase 6, README prose).
   */
  async presign(scope: AccessScope, body: PresignUploadBody): Promise<PresignUploadResponse> {
    this.nodeService.assertMayWrite(scope);

    // Resolved before anything is reserved: a batch aimed at a deleted or non-folder
    // parent must fail with one `410`/`422` rather than leaving ten blobs behind it.
    await this.nodeService.resolveParentLocation(scope, body.parentId);

    const room = await this.dataRooms.findInScope(scope);
    if (!room) throw new NotFoundException('Data Room not found.');

    const batchSize = body.files.reduce((total, file) => total + file.size, 0);
    if (room.totalSize + batchSize > DATA_ROOM_QUOTA_BYTES) {
      throw new UnprocessableEntityException(
        `This upload would exceed the Data Room's ${formatMegabytes(DATA_ROOM_QUOTA_BYTES)} limit.`,
      );
    }

    const files = [];
    for (const file of body.files) {
      const blob = await this.blobs.createPending(scope.dataRoomId, {
        mimeType: file.mimeType,
        size: file.size,
      });
      files.push({
        blobId: blob.id,
        uploadUrl: await this.storage.presignPut(blob.storageKey, file.mimeType),
      });
    }

    return { files };
  }

  /**
   * Turns one uploaded blob into a `FILE` node. **One file per call, never a batch**
   * (decision #28) — each carries its own `HEAD`, its own name conflict and its own moment
   * of landing, which is what per-file progress and per-file `422` need.
   *
   * Returns `null` for the node when the blob was already completed, so the caller can
   * answer `200` rather than `201`.
   */
  async complete(
    scope: AccessScope,
    body: CompleteUploadBody,
    createdById: string,
  ): Promise<{ node: NodeSummary; created: boolean }> {
    this.nodeService.assertMayWrite(scope);

    // Bounded by `storageKey: { startsWith: dataRoomId + '/' }`, which is the whole of a
    // blob's tenancy: without it a caller could attach another room's blob to their node.
    const blob = await this.blobs.findInRoom(scope.dataRoomId, body.blobId);
    if (!blob) throw new NotFoundException('Upload not found.');

    // The idempotent branch, taken **before** the bytes are re-validated. A `READY` blob
    // was verified once already, and re-running the checks here would risk deleting the
    // object behind a live file if the bytes at that key ever changed.
    if (blob.status === 'READY') {
      return { node: await this.replayOf(scope, blob.id), created: false };
    }

    const stored = await this.verifyStoredBytes(blob);

    return {
      node: await this.insertWithAutoSuffix(scope, body, blob, stored, createdById),
      created: true,
    };
  }

  /**
   * The `HEAD`, which runs **outside the transaction, before it opens**.
   *
   * The size and content type recorded on the blob at presign were the client's claims.
   * These are storage's, and they are the ones that feed the Data Room aggregates — a
   * client that under-reported a size would otherwise corrupt the quota for everyone in the
   * room.
   *
   * A violation deletes the object as well as refusing: it will never be referenced by a
   * node, and nothing else collects it in this phase.
   */
  private async verifyStoredBytes(blob: BlobRecord): Promise<StoredObject> {
    const stored = await this.storage.head(blob.storageKey);
    if (!stored) {
      throw new UnprocessableEntityException('The file was not uploaded.');
    }

    const problem = describeViolation(stored);
    if (problem) {
      await this.storage.delete(blob.storageKey);
      throw new UnprocessableEntityException(problem);
    }

    return stored;
  }

  /**
   * The whole of complete after the `HEAD`, in **one interactive transaction**, re-run from
   * the top on a name collision.
   *
   * The order inside is not interchangeable:
   *
   * 1. `pg_advisory_xact_lock` on the room — what makes the next step authoritative.
   * 2. the quota check, read inside the lock.
   * 3. the conditional `PENDING → READY` flip. Zero rows means a concurrent call completed
   *    this blob first, so this one takes the idempotent branch instead of creating a
   *    second node on one blob.
   * 4. the parent, re-resolved **inside** the transaction. A 10 MB `PUT` takes seconds and
   *    the parent can be deleted during them; a live node under a deleted ancestor is
   *    missing from its parent's listing and still readable by direct id.
   * 5. the node insert and the aggregate delta, together.
   *
   * **The retry re-runs all of it.** The flip sits inside the transaction precisely so a
   * `23505` on step 5 rolls it back too — the blob returns to `PENDING` and the next attempt
   * flips it again. Were the flip outside, or were only the insert retried, the second
   * attempt would find the blob `READY`, take the idempotent branch, find no node, and
   * answer `410` for an upload that had just succeeded.
   */
  private async insertWithAutoSuffix(
    scope: AccessScope,
    body: CompleteUploadBody,
    blob: BlobRecord,
    stored: StoredObject,
    createdById: string,
  ): Promise<NodeSummary> {
    for (let attempt = 0; attempt < AUTO_SUFFIX_ATTEMPTS; attempt += 1) {
      const name = attempt === 0 ? body.name : suffixedName(body.name, attempt);

      try {
        const created: NodeRecord | null = await this.transactions.run(async (tx) => {
          await this.nodes.lockDataRoom(tx, scope);

          const used = await this.dataRooms.usedBytesInTransaction(tx, scope);
          if (used + stored.size > DATA_ROOM_QUOTA_BYTES) {
            throw new UnprocessableEntityException(
              `This upload would exceed the Data Room's ${formatMegabytes(DATA_ROOM_QUOTA_BYTES)} limit.`,
            );
          }

          const flipped = await this.blobs.markReadyIfPending(tx, scope.dataRoomId, blob.id, {
            size: stored.size,
            mimeType: stored.contentType ?? blob.mimeType,
          });
          if (!flipped) return null;

          const destination = await this.nodeService.resolveParentLocation(
            scope,
            body.parentId,
            tx,
          );

          return this.nodes.createFile(tx, scope, {
            ...destination,
            name,
            blobId: blob.id,
            size: stored.size,
            createdById,
          });
        });

        if (created === null) return this.replayOf(scope, blob.id);
        return this.nodeService.toSummary(scope, created);
      } catch (error) {
        // Upload is the one operation that auto-suffixes: twenty dropped files must not
        // open twenty dialogs (decision #20). Create and rename refuse instead — the user
        // typed those names.
        if (isUniqueViolation(error)) continue;
        throw error;
      }
    }

    throw new ConflictException(`A file named "${body.name}" already exists in this folder.`);
  }

  /**
   * What a repeated complete answers.
   *
   * A `READY` blob proves complete committed once, and complete commits the flip and the
   * node insert **together** — so a missing live node cannot mean "not created yet". It
   * means the file was deleted afterwards, which is a `410`. The node is not re-created,
   * and the deleted row is not looked at: the two soft-delete bypasses are a closed list
   * and a third one is a stop-and-ask.
   */
  private async replayOf(scope: AccessScope, blobId: string): Promise<NodeSummary> {
    const node = await this.nodes.findByBlobId(scope, blobId);
    if (!node) throw new GoneException('This file was deleted by the owner.');
    return this.nodeService.toSummary(scope, node);
  }
}

/** What storage actually holds, against the two limits the presigned URL cannot enforce. */
function describeViolation(stored: StoredObject): string | null {
  if (stored.contentType !== UPLOAD_MIME_TYPE) return 'Only PDF files can be uploaded.';
  if (stored.size === 0) return 'The file is empty.';
  if (stored.size > MAX_FILE_SIZE_BYTES) {
    return `A file may be at most ${formatMegabytes(MAX_FILE_SIZE_BYTES)}.`;
  }
  return null;
}

/**
 * `contract.pdf` → `contract (1).pdf`: the suffix goes **before the final extension**, as
 * Drive and Windows do, so the file still opens by double-click.
 *
 * `nodeNameSchema` allows 255 characters, so a name at exactly that length has no room for
 * a suffix. The **stem** is shortened to make room and the suffix is kept whole — truncating
 * the suffix instead would produce a name that collides again, which is the one outcome the
 * retry cannot recover from.
 */
export function suffixedName(name: string, index: number): string {
  const suffix = ` (${index})`;
  const dot = name.lastIndexOf('.');
  const hasExtension = dot > 0 && dot < name.length - 1;
  const stem = hasExtension ? name.slice(0, dot) : name;
  const extension = hasExtension ? name.slice(dot) : '';

  const room = MAX_NAME_LENGTH - suffix.length - extension.length;
  if (room < 1) return `${stem}${suffix}`.slice(0, MAX_NAME_LENGTH);

  const trimmed = stem.length > room ? stem.slice(0, room).trimEnd() || stem.slice(0, 1) : stem;
  return `${trimmed}${suffix}${extension}`;
}

function formatMegabytes(bytes: number): string {
  return `${bytes / (1024 * 1024)} MB`;
}
