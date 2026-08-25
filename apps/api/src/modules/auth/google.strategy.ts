import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, type Profile, type VerifyCallback } from 'passport-google-oauth20';

import type { Env } from '../../config/env';
import type { GoogleIdentity } from './user.repository';

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor(config: ConfigService<Env, true>) {
    super({
      clientID: config.get('GOOGLE_CLIENT_ID', { infer: true }),
      clientSecret: config.get('GOOGLE_CLIENT_SECRET', { infer: true }),
      callbackURL: config.get('GOOGLE_CALLBACK_URL', { infer: true }),
      scope: ['email', 'profile'],
    });
  }

  /**
   * Turns a Google profile into the identity the repository understands. No database
   * work happens here — the strategy's job is to establish who this is, and the
   * controller decides what that means for our tables.
   *
   * `emailVerified` comes straight from Google, which is what makes matching a `USER`
   * share by email address sound with no extra verification of our own (decision #7).
   */
  override validate(
    _accessToken: string,
    _refreshToken: string,
    profile: Profile,
    done: VerifyCallback,
  ): void {
    const primaryEmail = profile.emails?.[0];
    if (!primaryEmail?.value) {
      done(new Error('Google account has no email address'));
      return;
    }

    const identity: GoogleIdentity = {
      providerAccountId: profile.id,
      email: primaryEmail.value,
      // The typings say boolean, but Google sends "true" as a string on some payload
      // shapes. Comparing the stringified value accepts both without lying to the types.
      emailVerified: String(primaryEmail.verified) === 'true',
      name: profile.displayName || null,
      avatarUrl: profile.photos?.[0]?.value ?? null,
    };

    done(null, identity);
  }
}
