import { Injectable, Logger } from '@nestjs/common';

import { AccessControlService } from '../../access/access-control.service';
import { UserRepository, type UserRecord } from '../auth/user.repository';
import { NodeRepository } from '../node/node.repository';
import { ShareRepository } from '../share/share.repository';
import {
  AUTO_GRANT_ENABLED,
  DEMO_OWNER_EMAIL,
  DEMO_ROOM_ID,
  DEMO_SHARE_FOLDER_ID,
} from './demo.constants';

/**
 * The share a reviewer arrives with.
 *
 * A reviewer has one Google account. Without this, signing in gives them their own empty
 * Data Room and nothing to look at, and the permissioned share — an explicit `BRIEF.md`
 * requirement — could only be demonstrated by creating a second account. So Acme Corp., the
 * demo owner the seed creates, grants one folder of its room to every new verified address.
 *
 * **It runs on every sign-in, not only at account creation**, following
 * `DataRoomService.ensureProvisioned`: the job is to *guarantee* the grant exists, so that a
 * database seeded after an account was created repairs itself. That makes idempotency
 * load-bearing rather than tidy — an unguarded create writes a new row on every session.
 *
 * Nothing here may fail a login. Every path returns quietly when the demo data is absent,
 * and `AuthService` catches whatever is left.
 */
@Injectable()
export class DemoGrantService {
  private readonly logger = new Logger(DemoGrantService.name);

  constructor(
    private readonly users: UserRepository,
    private readonly nodes: NodeRepository,
    private readonly shares: ShareRepository,
    private readonly access: AccessControlService,
  ) {}

  /**
   * Guarantees `user` holds a live `USER` grant on the demo room's shared folder.
   *
   * Five conditions, each of which returns without doing anything:
   *
   * - **The switch is off** (`AUTO_GRANT_ENABLED`). Stops new grants; revokes nothing.
   * - **The address is unverified.** `AccessControlService.resolveForUser` matches grants on
   *   a *verified* email only (decision #7), so a grant written for an unverified one is a
   *   row that can never resolve — worse than none, because it looks like access.
   * - **The user is the demo owner.** They own the room; a self-grant is meaningless and
   *   would list their own room in their own "Shared with me".
   * - **The demo data is absent or its folder was deleted** — a database that was never
   *   seeded, or one where the folder has since gone. Sign-in must not depend on demo data,
   *   and a grant pointing at a deleted node would greet its holder with a `410`.
   * - **A live grant on that folder already exists.** This is the idempotency.
   */
  async ensureGrantedTo(user: UserRecord): Promise<void> {
    if (!AUTO_GRANT_ENABLED) return;
    if (!user.emailVerified) return;
    if (user.email === DEMO_OWNER_EMAIL) return;

    const owner = await this.users.findByEmail(DEMO_OWNER_EMAIL);
    if (!owner) return;

    // **By id, never by name.** `findGrantNodeInRoom` is bounded by the room and returns
    // soft-deleted rows, which is why `deletedAt` is checked here rather than assumed: the
    // method exists to let a deleted grant target answer `410` elsewhere, and this caller
    // wants the opposite — no grant at all.
    const folder = await this.nodes.findGrantNodeInRoom(DEMO_ROOM_ID, DEMO_SHARE_FOLDER_ID);
    if (!folder || folder.deletedAt !== null) return;

    const held = await this.shares.findLiveGrantsForEmail(DEMO_ROOM_ID, user.email);
    if (held.some((grant) => grant.nodeId === DEMO_SHARE_FOLDER_ID)) return;

    // The demo owner's own scope, from the only producer of `AccessScope` there is. They
    // genuinely own this room, so nothing here reaches past a boundary already theirs.
    const scope = await this.access.resolveForUser(owner.id, DEMO_ROOM_ID);

    await this.shares.create(scope, {
      // **A folder, never the whole room.** A whole-room grant would hand over the room's
      // name and its whole-room totals — the one case where `browse` legitimately returns
      // `room` — and the interesting demonstration is the clipped one, where breadcrumbs
      // stop at the grant root and everything above it is invisible.
      nodeId: DEMO_SHARE_FOLDER_ID,
      mode: 'USER',
      // `shares_mode_check` requires `token_hash` null on every `USER` row: a `USER` share
      // carries no token (decision #27), and a token could never find one.
      tokenHash: null,
      granteeEmail: user.email,
      // No expiry. A demo that dies of old age looks like a bug to a reviewer.
      expiresAt: null,
      createdById: owner.id,
    });

    this.logger.log(`Granted the demo folder to ${user.email}.`);
  }
}
