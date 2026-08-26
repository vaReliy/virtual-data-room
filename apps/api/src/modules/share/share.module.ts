import { Module } from '@nestjs/common';

import { AccessModule } from '../../access/access.module';
import { PersistenceModule } from '../../persistence/persistence.module';
import { AuthModule } from '../auth/auth.module';
import { NodeModule } from '../node/node.module';
import { ShareController, SharedWithMeController } from './share.controller';
import { ShareService } from './share.service';

/**
 * Creating, listing and revoking shares.
 *
 * **Opening one is not here.** The anonymous `/s/:token` surface lives in `modules/public/`
 * (`architecture.md` § Folder layout), so that everything reachable without a session sits
 * in one directory rather than beside the owner endpoints it must not be confused with.
 *
 * `ShareRepository` is registered in `PersistenceModule` with the other repositories, not
 * here: that module is the only place `PrismaService` is injectable, and keeping the list
 * of things that may touch the database in one file is what makes the boundary reviewable.
 *
 * `NodeModule` is imported for `NodeService` — the write guard, and the order of checks
 * that separates `404` from `410`, are written once there and reused rather than restated.
 *
 * **Resolution does not live here.** `AccessControlService` reads `ShareRepository`
 * directly from `PersistenceModule`, and this module must never become a dependency of
 * `AccessModule`: `NodeModule` already imports `AccessModule`, so the reverse edge would
 * close a cycle.
 */
@Module({
  imports: [AccessModule, PersistenceModule, AuthModule, NodeModule],
  controllers: [ShareController, SharedWithMeController],
  providers: [ShareService],
})
export class ShareModule {}
