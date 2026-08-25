import type { PrismaService } from '../persistence/prisma.service';

/**
 * Setup and teardown for the integration tests.
 *
 * It is a repository — named as one so the ESLint boundary treats it as one — because it
 * is the only test-side code that touches tables directly. Everything a test actually
 * asserts goes through the real repositories and services; this exists solely to give
 * each test an empty database and a subject to act as.
 */
export class FixturesRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Empties the database between tests.
   *
   * Rooms before users: `DataRoom.owner` and `Node.createdBy` are `onDelete: Restrict`,
   * while nodes and shares cascade from the room. Deleting in the other order fails on a
   * foreign key rather than leaving anything behind.
   *
   * These are real deletes, not soft ones. The soft-delete extension rewrites *reads*, so
   * `deleteMany` passes through untouched — which is what a teardown needs and what
   * production must never do.
   */
  async reset(): Promise<void> {
    await this.prisma.client.dataRoom.deleteMany({});
    await this.prisma.client.blob.deleteMany({});
    await this.prisma.client.user.deleteMany({});
  }

  /** The room's counters as the database holds them, for asserting an aggregate delta. */
  async roomCounters(
    dataRoomId: string,
  ): Promise<{ totalSize: number; fileCount: number; folderCount: number }> {
    const room = await this.prisma.client.dataRoom.findFirstOrThrow({
      where: { id: dataRoomId },
      select: { totalSize: true, fileCount: true, folderCount: true },
    });
    return {
      totalSize: Number(room.totalSize),
      fileCount: room.fileCount,
      folderCount: room.folderCount,
    };
  }

  /** A folder's own subtree counters, read back by id rather than through a listing. */
  async nodeCounters(
    nodeId: string,
  ): Promise<{ totalSize: number; fileCount: number; folderCount: number }> {
    const node = await this.prisma.client.node.findFirstOrThrow({
      where: { id: nodeId },
      select: { totalSize: true, fileCount: true, folderCount: true },
    });
    return {
      totalSize: Number(node.totalSize),
      fileCount: node.fileCount,
      folderCount: node.folderCount,
    };
  }

  /** The live name of a node, to prove a refused rename changed nothing. */
  async nodeName(nodeId: string): Promise<string> {
    const node = await this.prisma.client.node.findFirstOrThrow({
      where: { id: nodeId },
      select: { name: true },
    });
    return node.name;
  }
}
