import { Module } from '@nestjs/common';

import { AccessModule } from '../../access/access.module';
import { PersistenceModule } from '../../persistence/persistence.module';
import { AuthModule } from '../auth/auth.module';
import { NodeController } from './node.controller';
import { NodeService } from './node.service';

/**
 * `NodeRepository` is registered in `PersistenceModule` alongside the other repositories,
 * not here: it is the only place `PrismaService` is injectable, and keeping the list of
 * things that may touch the database in one file is what makes the boundary reviewable.
 *
 * `AuthModule` is imported for `JwtAuthGuard`, which the controller applies.
 *
 * `NodeService` is exported because the upload protocol resolves nodes through it — the
 * order of checks that tells a `404` from a `410`, and the live-`FOLDER` parent rule, are
 * written once here rather than a second time in `modules/file/`.
 */
@Module({
  imports: [AccessModule, PersistenceModule, AuthModule],
  controllers: [NodeController],
  providers: [NodeService],
  exports: [NodeService],
})
export class NodeModule {}
