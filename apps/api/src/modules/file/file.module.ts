import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';

import { AccessModule } from '../../access/access.module';
import { SessionThrottlerGuard } from '../../common/session-throttler.guard';
import { throttlerConfig } from '../../common/throttler.config';
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
 * `ThrottlerModule.forRoot` is applied here rather than in `AppModule` on purpose: no
 * `APP_GUARD` is registered anywhere, so no route gets a limit it was not designed around.
 * What `forRoot` provides is global whether it is called here or not — the module is
 * `@Global()` — which is exactly why the options array it is handed now carries **both**
 * named buckets and why `ShareModule` is handed the same one. Two arrays would be two
 * providers for one global token, and the loser would silently decide nothing.
 *
 * `ContentService` is exported for `PublicShareController`: a share visitor opens the same
 * file through the same signing path, and a second one would be a second place for the
 * disposition rules to be got wrong.
 */
@Module({
  imports: [
    AccessModule,
    PersistenceModule,
    StorageModule,
    AuthModule,
    NodeModule,
    ThrottlerModule.forRoot(throttlerConfig),
  ],
  controllers: [UploadController, ContentController],
  providers: [UploadService, ContentService, SessionThrottlerGuard],
  exports: [ContentService],
})
export class FileModule {}
