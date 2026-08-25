import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { MeResponse, SessionUser } from '@dr/contracts';

import { DataRoomService } from '../data-room/data-room.service';
import { SESSION_TTL_SECONDS } from './session';
import { UserRepository, type GoogleIdentity, type UserRecord } from './user.repository';

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UserRepository,
    private readonly dataRooms: DataRoomService,
    private readonly jwt: JwtService,
  ) {}

  /**
   * Completes a Google sign-in: resolve the identity to a user, then guarantee that user
   * has a Data Room. Provisioning happens on every sign-in rather than only on account
   * creation, so an account that somehow ends up with no rooms recovers by itself.
   */
  async completeGoogleLogin(identity: GoogleIdentity): Promise<UserRecord> {
    const user = await this.users.upsertFromGoogle(identity);
    await this.dataRooms.ensureProvisioned(user.id);
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
