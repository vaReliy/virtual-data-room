import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';

import { AccessModule } from '../../access/access.module';
import { ClientIpThrottlerGuard } from '../../common/client-ip-throttler.guard';
import { throttlerConfig } from '../../common/throttler.config';
import { FileModule } from '../file/file.module';
import { NodeModule } from '../node/node.module';
import { PublicShareController } from './public-share.controller';

/**
 * **The anonymous surface, in a module of its own** — `architecture.md` § Folder layout
 * places it here rather than under `share/`, and the separation is worth more than the
 * one extra file it costs: everything in this codebase that runs without a session lives
 * in this directory, so "what is reachable with no account?" is a question answered by
 * `ls` instead of by reading guard decorators across two modules.
 *
 * It **owns no service**. `AccessControlService` produces the scope from the token,
 * `NodeService` lists, `ContentService` signs — the same three an authenticated request
 * goes through. A public listing path or a public content path written here would be a
 * second implementation of rules that are security-relevant in the first.
 *
 * It does not import `ShareModule`, and does not need to: creating, listing and revoking
 * shares are owner operations, and resolving one is `AccessControlService`'s job, which
 * reads `ShareRepository` straight from `PersistenceModule`.
 *
 * `ThrottlerModule.forRoot` is handed **the same options array** `FileModule` is handed.
 * The module is `@Global()`, so two different arrays would be two providers racing for one
 * token and the loser would silently take the other's limits with it; identical arrays
 * make the race a tie. See `common/throttler.config.ts`.
 */
@Module({
  imports: [AccessModule, NodeModule, FileModule, ThrottlerModule.forRoot(throttlerConfig)],
  controllers: [PublicShareController],
  providers: [ClientIpThrottlerGuard],
})
export class PublicModule {}
