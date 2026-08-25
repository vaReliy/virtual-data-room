import { Injectable, NotFoundException } from '@nestjs/common';

import { DataRoomRepository } from '../modules/data-room/data-room.repository';
import { brandAccessScope, type AccessScope } from './access-scope';

/**
 * The single authorization decision point. It answers with a boundary — an
 * `AccessScope` — rather than with a yes or no, so that everything downstream is
 * confined by construction instead of by a check someone has to remember.
 *
 * It is the only producer of `AccessScope` in the system; see `access-scope.ts` for how
 * that is enforced rather than merely asked for.
 */
@Injectable()
export class AccessControlService {
  constructor(private readonly dataRooms: DataRoomRepository) {}

  /**
   * Resolves what a signed-in user may reach inside a Data Room.
   *
   * Phase 2 has one path: the owner, scoped to the whole room. The grant path
   * (a live `USER` share on this node or an ancestor, matched on the *verified* session
   * email) arrives with sharing in Phase 4 and plugs in below, returning a scope whose
   * `rootPath` is the granted node's own path and whose role is `VIEWER`.
   *
   * **No grant is `404`, never `403`.** A `403` would confirm that the room exists, and
   * existence is itself information — the same reason a node outside a scope is
   * indistinguishable from one that was never created.
   */
  async resolveForUser(userId: string, dataRoomId: string): Promise<AccessScope> {
    const owned = await this.dataRooms.findOwnedById(userId, dataRoomId);
    if (owned) {
      return brandAccessScope({
        dataRoomId,
        // The whole room: there is no ancestor path to clip, so every node in the room
        // is inside the boundary and `path LIKE '/%'` matches all of them.
        rootNodeId: null,
        rootPath: '/',
        role: 'OWNER',
      });
    }

    throw new NotFoundException('Data Room not found.');
  }
}
