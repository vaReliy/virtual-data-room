import { Module } from '@nestjs/common';

import { StorageService } from './storage.service';

/**
 * Storage is its own module rather than a provider inside `FileModule`: the content URL
 * endpoint needs it too, and Phase 4's public share surface will as well. A shared client
 * that lives inside one feature is a client that eventually gets constructed twice.
 */
@Module({
  providers: [StorageService],
  exports: [StorageService],
})
export class StorageModule {}
