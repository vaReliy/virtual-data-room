import { createHash, randomBytes } from 'node:crypto';

/**
 * The `LINK` token, and the one-way function that stores it.
 *
 * 32 random bytes — 256 bits — rather than a UUIDv4, whose 122 bits of entropy are spent
 * on a value that is *designed* to be handed around in URLs and logs. This one is the
 * capability itself: whoever holds it is the caller.
 *
 * Only the SHA-256 goes into `token_hash`, so a database dump yields no working links.
 * There is no salt and none is wanted: a random 256-bit preimage is not brute-forcible,
 * and the lookup has to be a single indexed equality on the digest.
 *
 * The plaintext therefore exists **exactly once**, in the response to the create call. No
 * endpoint can show it again, and adding one later would defeat the reason it is hashed.
 */
export function createShareToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashShareToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
