import { Module } from '@nestjs/common';

import { UserRepository } from '../modules/auth/user.repository';
import { DataRoomRepository } from '../modules/data-room/data-room.repository';
import { PrismaService } from './prisma.service';

/**
 * `PrismaService` is provided here and **deliberately not exported**, so no feature
 * module can inject it. Repositories are the only things that receive it, and they are
 * enumerated below — which makes "what may touch the database" a list in one file rather
 * than a convention someone can drift away from.
 *
 * The repository classes live beside the feature they serve (see architecture.md), but
 * they are registered here because this is where the client they depend on lives. That
 * inversion is the price of the guarantee, and it is the reason the ESLint import
 * boundary allows `*.repository.ts` and this directory, and nothing else.
 */
@Module({
  providers: [PrismaService, UserRepository, DataRoomRepository],
  exports: [UserRepository, DataRoomRepository],
})
export class PersistenceModule {}
