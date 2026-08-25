import { Module } from '@nestjs/common';

import { PersistenceModule } from '../../persistence/persistence.module';
import { DataRoomService } from './data-room.service';

@Module({
  imports: [PersistenceModule],
  providers: [DataRoomService],
  exports: [DataRoomService],
})
export class DataRoomModule {}
