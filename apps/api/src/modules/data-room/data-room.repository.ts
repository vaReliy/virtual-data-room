import { Injectable } from '@nestjs/common';
import type { DataRoomIdentity, DataRoomSummary } from '@dr/contracts';

import type { AccessScope } from '../../access/access-scope';
import { PrismaService } from '../../persistence/prisma.service';

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

  async countOwnedBy(ownerId: string): Promise<number> {
    return this.prisma.client.dataRoom.count({ where: { ownerId } });
  }

  async create(ownerId: string, name: string): Promise<DataRoomSummary> {
    const room = await this.prisma.client.dataRoom.create({
      data: { ownerId, name },
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
