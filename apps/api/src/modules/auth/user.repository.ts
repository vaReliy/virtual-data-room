import { Injectable } from '@nestjs/common';

import { Provider } from '../../generated/prisma/client';
import { PrismaService } from '../../persistence/prisma.service';

/** What Google tells us about the person signing in. */
export interface GoogleIdentity {
  providerAccountId: string;
  email: string;
  emailVerified: boolean;
  name: string | null;
  avatarUrl: string | null;
}

export interface UserRecord {
  id: string;
  email: string;
  emailVerified: boolean;
  name: string | null;
  avatarUrl: string | null;
}

/**
 * `User` and `Account` are separate tables so that a second provider later does not
 * create a duplicate person (decision #8).
 *
 * These methods are keyed by identity rather than by `AccessScope`: there is no tree to
 * bound, and the caller is by definition the row's subject. This is one of the
 * scope-exceptions the Phase 2 inventory records.
 */
@Injectable()
export class UserRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resolves a Google identity to a user, creating both rows on first sign-in.
   *
   * Matching is by `(provider, providerAccountId)` — Google's stable `sub` — rather than
   * by email, because an email address can change hands while `sub` cannot.
   */
  async upsertFromGoogle(identity: GoogleIdentity): Promise<UserRecord> {
    const email = identity.email.trim().toLowerCase();

    return this.prisma.client.$transaction(async (tx) => {
      const existing = await tx.account.findUnique({
        where: {
          provider_providerAccountId: {
            provider: Provider.GOOGLE,
            providerAccountId: identity.providerAccountId,
          },
        },
        select: { userId: true },
      });

      if (existing) {
        return tx.user.update({
          where: { id: existing.userId },
          data: {
            email,
            emailVerified: identity.emailVerified,
            name: identity.name,
            avatarUrl: identity.avatarUrl,
          },
          select: this.selection,
        });
      }

      // A user may already exist under this email from a future second provider; link
      // the new account to them rather than creating a duplicate person.
      const user =
        (await tx.user.findFirst({ where: { email }, select: { id: true } })) ??
        (await tx.user.create({
          data: {
            email,
            emailVerified: identity.emailVerified,
            name: identity.name,
            avatarUrl: identity.avatarUrl,
          },
          select: { id: true },
        }));

      await tx.account.create({
        data: {
          userId: user.id,
          provider: Provider.GOOGLE,
          providerAccountId: identity.providerAccountId,
        },
      });

      return tx.user.findFirstOrThrow({ where: { id: user.id }, select: this.selection });
    });
  }

  /**
   * A user by their normalized address. One caller: `DemoShareService`, resolving the demo
   * owner named in the environment to the row that owns the demo room.
   *
   * `email` is `@unique` and every writer lower-cases it, so this is a single-row read on
   * an index — but it is **not** an authorization primitive and must not become one. An
   * address identifies a person only once it has been verified, which is why every path
   * that decides access reads `emailVerified` rather than trusting the string
   * (decision #7).
   */
  async findByEmail(email: string): Promise<UserRecord | null> {
    return this.prisma.client.user.findFirst({
      where: { email: email.trim().toLowerCase() },
      select: this.selection,
    });
  }

  async findById(userId: string): Promise<UserRecord | null> {
    return this.prisma.client.user.findFirst({
      where: { id: userId },
      select: this.selection,
    });
  }

  private readonly selection = {
    id: true,
    email: true,
    emailVerified: true,
    name: true,
    avatarUrl: true,
  } as const;
}
