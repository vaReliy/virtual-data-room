import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../persistence/prisma.service';
import type { TransactionClient } from '../node/node.repository';

/** A blob as the upload service needs it. `BigInt` stops at this boundary, as elsewhere. */
export interface BlobRecord {
  id: string;
  storageKey: string;
  mimeType: string;
  size: number;
  status: 'PENDING' | 'READY';
}

/**
 * The stored bytes of a file.
 *
 * **This repository takes `scope.dataRoomId`, not a full `AccessScope`** — a blob has no
 * `path` and no ancestry to clip, so there is nothing for `rootPath` to bound. It is one of
 * the deviations recorded in `architecture.md` § Scope-exception inventory.
 *
 * What bounds it instead is the key. `Blob` has **no `dataRoomId` column**: a blob belongs
 * to no room until a node points at it, and `storageKey` — `${dataRoomId}/${blobId}` — *is*
 * the tenancy (decision #28). Every read here therefore carries
 * `storageKey: { startsWith: dataRoomId + '/' }` beside the id. Without it a caller could
 * attach another room's `blobId` to a node in their own room.
 *
 * That predicate needs **no raw SQL**: Prisma's `startsWith` compiles to `LIKE`, so the
 * boundary stays in the `WHERE` clause and `node.repository.ts` remains the only file the
 * ESLint rule permits raw statements in. `Blob` is also absent from
 * `SOFT_DELETABLE_MODELS`, so the soft-delete extension does not touch these reads.
 */
@Injectable()
export class BlobRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Reserves a blob for an upload that has not happened yet: `PENDING`, with the size and
   * type the client *claimed*. Both are overwritten at complete from what storage actually
   * holds.
   *
   * **The id is generated here, before the insert**, exactly as `createFolder` does it for
   * a node: `storageKey` contains the row's own id and is `NOT NULL`, so a database-side
   * default is not known in time to build it.
   */
  async createPending(
    dataRoomId: string,
    input: { mimeType: string; size: number },
  ): Promise<BlobRecord> {
    const id = randomUUID();
    const created = await this.prisma.client.blob.create({
      data: {
        id,
        storageKey: storageKeyFor(dataRoomId, id),
        mimeType: input.mimeType,
        size: input.size,
      },
    });
    return toRecord(created);
  }

  /** A blob by id, bounded by the room that owns its key. */
  async findInRoom(dataRoomId: string, blobId: string): Promise<BlobRecord | null> {
    const blob = await this.prisma.client.blob.findFirst({
      where: { id: blobId, storageKey: { startsWith: `${dataRoomId}/` } },
    });
    return blob ? toRecord(blob) : null;
  }

  /**
   * Every blob belonging to one Data Room, `PENDING` ones included.
   *
   * **No node walk, and none is possible or needed**: `Blob` has no `dataRoomId` column, and
   * the key prefix *is* the tenancy (decision #28). A blob whose upload was presigned and
   * abandoned is therefore listed too, which is correct for the one caller — the seed's
   * reset, which is collecting object keys to remove.
   */
  async listInRoom(dataRoomId: string): Promise<BlobRecord[]> {
    const blobs = await this.prisma.client.blob.findMany({
      where: { storageKey: { startsWith: `${dataRoomId}/` } },
    });
    return blobs.map((blob) => toRecord(blob));
  }

  /**
   * **A hard delete, and one of only two in the system** — see
   * `DataRoomRepository.deleteOwned` for the other and for why they exist at all.
   *
   * **Order is load-bearing: the room's nodes must be gone first.** `nodes_blob_id_fkey` is
   * `ON DELETE SET NULL`, so running this while a `FILE` still points at a blob would null
   * its `blob_id` and trip `nodes_type_blob_check` — a file that exists with no bytes is
   * exactly the state that constraint is there to make impossible.
   *
   * It removes the rows, not the objects. Storage is a separate system with no transaction
   * to join, so the caller deletes the bytes itself, from the keys `listInRoom` handed it.
   */
  async deleteAllInRoom(dataRoomId: string): Promise<number> {
    const { count } = await this.prisma.client.blob.deleteMany({
      where: { storageKey: { startsWith: `${dataRoomId}/` } },
    });
    return count;
  }

  /**
   * The idempotency hinge of upload-complete: a **conditional** flip, not a read followed
   * by a write.
   *
   * `updateMany` compiles to `UPDATE blobs SET … WHERE id = $1 AND status = 'PENDING' …`,
   * so the check and the write are one statement and two concurrent completes cannot both
   * observe `PENDING`. A count of zero means this blob was already completed — the caller
   * takes the idempotent branch and looks the existing node up by `blobId`.
   *
   * Without this, a lost response over a committed transaction produces two nodes on one
   * blob and charges the Data Room aggregates twice for bytes that exist once.
   *
   * It runs inside the caller's transaction, because a flip that commits while the node
   * insert rolls back is exactly the state the retry must not find.
   */
  async markReadyIfPending(
    tx: TransactionClient,
    dataRoomId: string,
    blobId: string,
    stored: { size: number; mimeType: string },
  ): Promise<boolean> {
    const { count } = await tx.blob.updateMany({
      where: {
        id: blobId,
        status: 'PENDING',
        storageKey: { startsWith: `${dataRoomId}/` },
      },
      data: { status: 'READY', size: stored.size, mimeType: stored.mimeType },
    });
    return count > 0;
  }
}

/**
 * `${dataRoomId}/${blobId}` — no name and no extension. The name is not the type anywhere
 * in this system, and a key built from one would leak a document title into object storage
 * and into every access log that records it.
 */
export function storageKeyFor(dataRoomId: string, blobId: string): string {
  return `${dataRoomId}/${blobId}`;
}

function toRecord(blob: {
  id: string;
  storageKey: string;
  mimeType: string;
  size: bigint;
  status: string;
}): BlobRecord {
  return {
    id: blob.id,
    storageKey: blob.storageKey,
    mimeType: blob.mimeType,
    size: Number(blob.size),
    status: blob.status as BlobRecord['status'],
  };
}
