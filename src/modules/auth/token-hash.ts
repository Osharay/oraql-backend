import { createHash, timingSafeEqual } from 'crypto';

/**
 * How refresh tokens are stored and compared.
 *
 * They used to be stored with bcrypt, which silently reads only the first 72
 * bytes of its input. A JWT's first 72 bytes are its fixed header plus the
 * start of the user's id, so any string with that prefix matched the stored
 * hash — a refresh token could be forged from a user id alone.
 *
 * A refresh token is a long random-looking secret, not a password: it needs
 * no slow, salted hash, only one that reads all of it. SHA-256 does, and the
 * comparison is constant-time.
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function tokenMatches(token: string, storedHash: string | null | undefined): boolean {
  if (!storedHash) return false;
  const a = Buffer.from(hashToken(token), 'hex');
  const b = Buffer.from(storedHash, 'hex');
  // A bcrypt hash left over from before this change is not hex of this
  // length, so it simply fails to match: the user signs in once more.
  return a.length === b.length && timingSafeEqual(a, b);
}
