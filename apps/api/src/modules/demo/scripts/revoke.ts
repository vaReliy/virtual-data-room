import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AccessControlService } from '../../../access/access-control.service';
import { AppModule } from '../../../app.module';
import { UserRepository } from '../../auth/user.repository';
import { DataRoomRepository } from '../../data-room/data-room.repository';
import { ShareRepository } from '../../share/share.repository';
import {
  AUTO_GRANT_ENABLED,
  DEMO_OWNER_EMAIL,
  DEMO_ROOM_ID,
  DEMO_SHARE_FOLDER_ID,
} from '../demo.constants';

/**
 * Takes the demo folder back from everyone the first-login grant handed it to. Run it with
 * `pnpm demo:revoke` from `apps/api`.
 *
 * **It revokes `USER` grants on the demo folder and nothing else.** Not every share in the
 * room: a `LINK` share into the demo room — a public `/s/:token` demo link of the kind
 * Phase 5 plans for the README — is a deliberate artefact somebody made by hand, and killing
 * it as a side effect of taking back the auto-grants would be a surprise. Revoking
 * everything is what a re-seed does, and it says so.
 *
 * **Revoke, not delete**, exactly as the single-share path in the app is: the row survives
 * carrying `revoked_at`, so *when* access ended stays on the record.
 *
 * **Order matters, and this is the whole reason the warning below exists.** The grant is
 * re-issued on the next sign-in of anyone it was taken from, so running this while
 * `AUTO_GRANT_ENABLED` is `true` buys nothing beyond the current sessions. Set the constant
 * to `false`, deploy, *then* run this. See `docs/decisions.md` #32.
 *
 * There is no endpoint for this and there must not be one: it is an operator action with no
 * undo, and access comes back only through a fresh sign-in.
 */
async function main(): Promise<void> {
  const logger = new Logger('DemoRevoke');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });

  try {
    const users = app.get(UserRepository);
    const dataRooms = app.get(DataRoomRepository);
    const shares = app.get(ShareRepository);
    const access = app.get(AccessControlService);

    const owner = await users.findByEmail(DEMO_OWNER_EMAIL);
    if (!owner) {
      logger.log(`No demo owner (${DEMO_OWNER_EMAIL}) in this database — nothing to revoke.`);
      return;
    }

    const room = await dataRooms.findOwnedById(owner.id, DEMO_ROOM_ID);
    if (!room) {
      logger.log('The demo Data Room is not in this database — nothing to revoke.');
      return;
    }

    const scope = await access.resolveForUser(owner.id, DEMO_ROOM_ID);

    const live = await shares.listLiveForNode(scope, DEMO_SHARE_FOLDER_ID);
    const grants = live.filter((share) => share.mode === 'USER');

    if (grants.length === 0) {
      logger.log('No live demo grants. Nothing to do.');
    } else {
      await shares.revokeMany(
        scope,
        grants.map((grant) => grant.id),
      );
      logger.log(`Revoked ${grants.length} demo grant(s). Access ends on the next request.`);
    }

    const skipped = live.length - grants.length;
    if (skipped > 0) {
      logger.log(`Left ${skipped} non-USER share(s) on the demo folder alone, by design.`);
    }

    if (AUTO_GRANT_ENABLED) {
      logger.warn(
        'AUTO_GRANT_ENABLED is still true. Everyone revoked here will be granted again the ' +
          'next time they sign in. Set it to false in demo.constants.ts, deploy, then run ' +
          'this again — in that order.',
      );
    }
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  new Logger('DemoRevoke').error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
