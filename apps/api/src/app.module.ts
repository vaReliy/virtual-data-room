import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { validateEnv } from './config/env';
import { AuthModule } from './modules/auth/auth.module';
import { DataRoomModule } from './modules/data-room/data-room.module';
import { HealthModule } from './modules/health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // One .env at the repository root, shared by both apps. In Cloud Run there is no
      // file and the real environment comes from Secret Manager, which this reads too.
      envFilePath: ['../../.env'],
      validate: validateEnv,
      cache: true,
    }),
    HealthModule,
    AuthModule,
    DataRoomModule,
  ],
})
export class AppModule {}
