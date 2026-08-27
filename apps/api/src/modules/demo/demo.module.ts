import { Module } from '@nestjs/common';

import { AccessModule } from '../../access/access.module';
import { PersistenceModule } from '../../persistence/persistence.module';
import { DemoGrantService } from './demo-grant.service';

/**
 * Everything the demo is, as one removable unit: the constants, the tree it seeds, the
 * first-login grant, and the two operator entrypoints in `scripts/`.
 *
 * **Those two are entrypoints, not library code.** They sit under `src` rather than in a
 * top-level `scripts/` because `tsconfig.json` includes `src` alone and ESLint's
 * `projectService` refuses any file no tsconfig claims — a sibling directory would need its
 * own tsconfig and would still fall outside `pnpm typecheck`. They boot the whole
 * `AppModule` and go through the same repositories a request does, so their nearest relative
 * is `main.ts`.
 *
 * **It is a module of its own rather than part of `ShareModule`, and that is a cycle rather
 * than a preference.** `AuthModule` is the consumer, and `ShareModule` imports `AuthModule`
 * for `JwtAuthGuard`; putting the grant service there would make
 * `AuthModule → ShareModule → AuthModule`. This module imports no controller-bearing module
 * and depends only on `PersistenceModule` and `AccessModule`, so the edge runs one way.
 *
 * **Removing the demo** is this directory plus two lines in `AuthModule`/`AuthService` —
 * and then the repository methods that exist only for it, which cannot live here because
 * `PrismaService` is injectable only in `PersistenceModule`. `docs/decisions.md` #32 lists
 * them.
 */
@Module({
  imports: [PersistenceModule, AccessModule],
  providers: [DemoGrantService],
  exports: [DemoGrantService],
})
export class DemoModule {}
