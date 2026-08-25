import { Injectable } from '@nestjs/common';
import type { DataRoomSummary } from '@dr/contracts';

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

  async listOwnedBy(ownerId: string): Promise<DataRoomSummary[]> {
    const rooms = await this.prisma.client.dataRoom.findMany({
      where: { ownerId },
      orderBy: { createdAt: 'asc' },
      select: this.selection,
    });
    return rooms.map((room) => this.toSummary(room));
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
