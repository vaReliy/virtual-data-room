import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';

import type { Env } from '../../config/env';
import { PersistenceModule } from '../../persistence/persistence.module';
import { DataRoomModule } from '../data-room/data-room.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { GoogleStrategy } from './google.strategy';
import { JwtAuthGuard } from './jwt-auth.guard';
import { JwtStrategy } from './jwt.strategy';
import { MeController } from './me.controller';
import { SESSION_TTL_SECONDS } from './session';

@Module({
  imports: [
    PersistenceModule,
    DataRoomModule,
    // No session middleware: the OAuth handshake is stateless, so there is no server-side
    // session store to run or to scale.
    PassportModule.register({ session: false }),
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        secret: config.get('SESSION_SECRET', { infer: true }),
        signOptions: { expiresIn: SESSION_TTL_SECONDS },
      }),
    }),
  ],
  controllers: [AuthController, MeController],
  providers: [AuthService, GoogleStrategy, JwtStrategy, JwtAuthGuard],
  /**
   * **`JwtModule` is exported, and that is not tidiness — the guard does not work without
   * it.** A guard named in `@UseGuards()` is constructed in the module that declares the
   * *controller*, not in the module that provides the guard, so exporting `JwtAuthGuard`
   * alone is not enough: its `JwtService` has to be resolvable in `NodeModule` and
   * `FileModule` too.
   *
   * Missing, the guard is built with `jwt` undefined and every guarded request outside this
   * module answers `500` — but only once the session passes
   * `SESSION_REISSUE_AFTER_SECONDS`, because `reissueIfStale` returns before touching
   * `this.jwt` until then. That delay is why it survived a full manual walk of the app:
   * a fresh login never reaches the branch. `ConfigService` hides the symptom further by
   * resolving anyway — `ConfigModule` is global.
   */
  exports: [AuthService, JwtAuthGuard, JwtModule],
})
export class AuthModule {}
