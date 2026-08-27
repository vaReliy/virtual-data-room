import { Injectable } from '@nestjs/common';
import type { DataRoomIdentity, DataRoomSummary } from '@dr/contracts';

import type { AccessScope } from '../../access/access-scope';
import { PrismaService, type TransactionClient } from '../../persistence/prisma.service';

/**
 * Data Rooms owned by a given user.
 *
 * Bounded by `ownerId` rather than by `AccessScope`: a Data Room is the scoping boundary
 * itself, so there is no ancestor path to clip. Rooms reached through a share are
 * resolved by `AccessControlService`, not here. This is one of the scope-exceptions the
 * Phase 2 inventory records.
 */
@Injectable()
export class DataRoomRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * What `GET /api/me` reports: identity only. The aggregates deliberately do not travel
   * with the session — they belong to whatever the caller is currently looking at
   * (decision #24), so a folder create no longer has to invalidate the session query.
   */
  async listOwnedBy(ownerId: string): Promise<DataRoomIdentity[]> {
    return this.prisma.client.dataRoom.findMany({
      where: { ownerId },
      orderBy: { createdAt: 'asc' },
      select: { id: true, name: true },
    });
  }

  /**
   * The owner half of scope resolution. Bounded by `ownerId` *and* `id`, so a room the
   * caller does not own comes back as `null` and becomes a `404` — never a `403`.
   */
  async findOwnedById(ownerId: string, dataRoomId: string): Promise<DataRoomSummary | null> {
    const room = await this.prisma.client.dataRoom.findFirst({
      where: { id: dataRoomId, ownerId },
      select: this.selection,
    });
    return room ? this.toSummary(room) : null;
  }

  /**
   * The room a resolved scope belongs to, for the browser header at the room root.
   *
   * Bounded by `scope.dataRoomId` rather than by a path prefix: a Data Room is the
   * scoping boundary itself, so there is no ancestry to clip. The caller — not this
   * method — decides whether the room may be shown at all, and only does so when
   * `scope.rootNodeId === null`; a subtree-scoped caller must not learn the room's name
   * or its whole-room totals.
   */
  async findInScope(scope: AccessScope): Promise<DataRoomSummary | null> {
    const room = await this.prisma.client.dataRoom.findFirst({
      where: { id: scope.dataRoomId },
      select: this.selection,
    });
    return room ? this.toSummary(room) : null;
  }

  /**
   * The room's used bytes, read **inside the caller's transaction**.
   *
   * This is the authoritative half of the quota check. The advisory number computed at
   * presign gives fast feedback over a whole batch and is deliberately not trusted: minutes
   * pass while the browser transfers the bytes, and other uploads land in between. Reading
   * it here, after `lockDataRoom`, is what makes the answer true at the moment it is used.
   */
  async usedBytesInTransaction(tx: TransactionClient, scope: AccessScope): Promise<number> {
    const room = await tx.dataRoom.findFirstOrThrow({
      where: { id: scope.dataRoomId },
      select: { totalSize: true },
    });
    return Number(room.totalSize);
  }

  async countOwnedBy(ownerId: string): Promise<number> {
    return this.prisma.client.dataRoom.count({ where: { ownerId } });
  }

  /**
   * **The only hard delete of a Data Room in the system, and the seed's reset is its only
   * caller.** Everything a user does is a soft delete (decision #6): `deleted_at` is
   * stamped, the bytes stay, and nothing is ever removed. This is the deliberate exception —
   * re-seeding must leave the demo account in the state a fresh seed produces, not in that
   * state plus whatever the last run left behind.
   *
   * **It is bounded by `ownerId`, and that predicate is the safety rail.** A room id alone
   * would let a wrong argument erase a real customer's room; with the owner in the `where`,
   * the worst a mistake can do is erase a room the demo owner holds. Do not "simplify" it
   * away.
   *
   * Nodes and shares follow by `ON DELETE CASCADE` (`nodes_data_room_id_fkey`,
   * `shares_data_room_id_fkey`), so every grant into this room dies with it — which is the
   * intended meaning of a reset: yesterday's grantees lose access rather than keeping a
   * pointer into a room that has been rebuilt underneath them. `Blob` rows do **not**
   * cascade, because they hang off `nodes.blob_id` rather than off the room; the caller
   * removes them, and their objects, afterwards.
   *
   * `deleteMany` rather than `delete`, so that a room that is already gone is a no-op
   * instead of an exception. The soft-delete extension narrows reads only, so this really
   * does delete — and it reaches a soft-deleted room too, which is what a reset wants.
   */
  async deleteOwned(ownerId: string, dataRoomId: string): Promise<void> {
    await this.prisma.client.dataRoom.deleteMany({ where: { id: dataRoomId, ownerId } });
  }

  /**
   * `id` is optional and has exactly one caller: the demo seed, which pins the demo room's
   * identity so that a re-seed lands on the same room and the first-login grant can address
   * it without knowing its name. Everywhere else it is omitted and the database default
   * applies — a Data Room's id is not something a request may choose.
   */
  async create(ownerId: string, name: string, id?: string): Promise<DataRoomSummary> {
    const room = await this.prisma.client.dataRoom.create({
      data: { ownerId, name, ...(id === undefined ? {} : { id }) },
      select: this.selection,
    });
    return this.toSummary(room);
  }

  /**
   * `BigInt` stops here. `JSON.stringify` throws on a bigint, so sizes cross the wire as
   * `number` — safe by a wide margin, since the 200 MB quota is ~45 million times below
   * `Number.MAX_SAFE_INTEGER`.
   */
  private toSummary(room: {
    id: string;
    name: string;
    totalSize: bigint;
    fileCount: number;
    folderCount: number;
  }): DataRoomSummary {
    return {
      id: room.id,
      name: room.name,
      totalSize: Number(room.totalSize),
      fileCount: room.fileCount,
      folderCount: room.folderCount,
    };
  }

  private readonly selection = {
    id: true,
    name: true,
    totalSize: true,
    fileCount: true,
    folderCount: true,
  } as const;
}
