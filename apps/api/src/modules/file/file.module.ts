import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';

import { AccessModule } from '../../access/access.module';
import { SessionThrottlerGuard } from '../../common/session-throttler.guard';
import { presignThrottlerConfig } from '../../common/throttler.config';
import { PersistenceModule } from '../../persistence/persistence.module';
import { StorageModule } from '../../storage/storage.module';
import { AuthModule } from '../auth/auth.module';
import { NodeModule } from '../node/node.module';
import { ContentController } from './content.controller';
import { ContentService } from './content.service';
import { UploadController } from './upload.controller';
import { UploadService } from './upload.service';

/**
 * The upload protocol and the content URL.
 *
 * `BlobRepository` is registered in `PersistenceModule` with the other repositories, not
 * here: that module is the only place `PrismaService` is injectable, and keeping the list of
 * things that may touch the database in one file is what makes the boundary reviewable.
 *
 * `NodeModule` is imported for `NodeService` — the order of checks that separates `404` from
 * `410`, the live-`FOLDER` parent rule and the wire shape are written once, there.
 *
 * `ThrottlerModule.forRoot` is applied here rather than in `AppModule` on purpose. The
 * limit belongs to presign and nothing else has one, so registering it globally would put a
 * guard in front of routes that neither need it nor were designed around it. The
 * configuration itself lives in `common/`, where `architecture.md` places it.
 */
@Module({
  imports: [
    AccessModule,
    PersistenceModule,
    StorageModule,
    AuthModule,
    NodeModule,
    ThrottlerModule.forRoot(presignThrottlerConfig),
  ],
  controllers: [UploadController, ContentController],
  providers: [UploadService, ContentService, SessionThrottlerGuard],
})
export class FileModule {}
