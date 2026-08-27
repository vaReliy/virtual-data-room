import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { MeResponse, SessionUser } from '@dr/contracts';

import { DataRoomService } from '../data-room/data-room.service';
import { DemoGrantService } from '../demo/demo-grant.service';
import { SESSION_TTL_SECONDS } from './session';
import { UserRepository, type GoogleIdentity, type UserRecord } from './user.repository';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly users: UserRepository,
    private readonly dataRooms: DataRoomService,
    private readonly demoGrants: DemoGrantService,
    private readonly jwt: JwtService,
  ) {}

  /**
   * Completes a Google sign-in: resolve the identity to a user, then guarantee that user
   * has a Data Room. Provisioning happens on every sign-in rather than only on account
   * creation, so an account that somehow ends up with no rooms recovers by itself.
   *
   * The demo grant follows the same "guarantee, don't create once" rule and for the same
   * reason — see `DemoGrantService`. **It is wrapped**, because it is a convenience and
   * sign-in is not: a developer database with no demo data, or anything else going wrong in
   * there, must leave the user signed in rather than staring at a failed callback.
   */
  async completeGoogleLogin(identity: GoogleIdentity): Promise<UserRecord> {
    const user = await this.users.upsertFromGoogle(identity);
    await this.dataRooms.ensureProvisioned(user.id);

    try {
      await this.demoGrants.ensureGrantedTo(user);
    } catch (error) {
      this.logger.warn(
        `The demo share could not be granted to ${user.email}; sign-in continues. ${String(error)}`,
      );
    }

    return user;
  }

  issueSessionToken(user: Pick<UserRecord, 'id' | 'email'>): string {
    return this.jwt.sign({ sub: user.id, email: user.email }, { expiresIn: SESSION_TTL_SECONDS });
  }

  /** Everything the authenticated shell renders on load, in one call (decision #13). */
  async describeSession(userId: string): Promise<MeResponse | null> {
    const user = await this.users.findById(userId);
    if (!user) return null;

    return {
      user: this.toSessionUser(user),
      dataRooms: await this.dataRooms.listOwnedBy(user.id),
    };
  }

  private toSessionUser(user: UserRecord): SessionUser {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      avatarUrl: user.avatarUrl,
    };
  }
}
