import { Module } from '@nestjs/common';

import { PersistenceModule } from '../persistence/persistence.module';
import { AccessControlService } from './access-control.service';

/**
 * Authorization is its own module rather than a helper inside the node module: the
 * anonymous `/s/:token` surface resolves scopes through the same service in Phase 4, and
 * a shared decision point that lives inside one feature is a decision point that
 * eventually gets copied.
 */
@Module({
  imports: [PersistenceModule],
  providers: [AccessControlService],
  exports: [AccessControlService],
})
export class AccessModule {}
