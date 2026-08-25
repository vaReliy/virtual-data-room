import { Injectable } from '@nestjs/common';
import type { DataRoomSummary } from '@dr/contracts';

import { DataRoomRepository } from './data-room.repository';

/** The name a Data Room gets when one is provisioned automatically on first sign-in. */
const DEFAULT_ROOM_NAME = 'My Data Room';

@Injectable()
export class DataRoomService {
  constructor(private readonly dataRooms: DataRoomRepository) {}

  /**
   * Guarantees a signed-in user has somewhere to be. Without this a fresh account lands
   * on an empty shell with no room and no way to create one, which makes every
   * owner-side flow ungradable (decision #21).
   *
   * Idempotent by design: it provisions only when the user owns nothing, so signing in
   * again never adds a second room.
   */
  async ensureProvisioned(ownerId: string): Promise<DataRoomSummary[]> {
    const existing = await this.dataRooms.listOwnedBy(ownerId);
    if (existing.length > 0) return existing;

    const created = await this.dataRooms.create(ownerId, DEFAULT_ROOM_NAME);
    return [created];
  }

  async listOwnedBy(ownerId: string): Promise<DataRoomSummary[]> {
    return this.dataRooms.listOwnedBy(ownerId);
  }
}
