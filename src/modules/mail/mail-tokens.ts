import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';

/** A random one-time token for an email link, and the hash that is stored. */
export function newToken() {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashToken(token) };
}

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

const secret = () => process.env.MAIL_SECRET || process.env.JWT_SECRET || 'oraql-dev-secret';

/** The signature on an unsubscribe link, so nobody can unsubscribe someone else. */
export const unsubscribeSig = (userId: string) =>
  createHmac('sha256', secret()).update(`unsubscribe:${userId}`).digest('base64url').slice(0, 32);

export function unsubscribeOk(userId: string, sig: string | undefined) {
  if (!sig) return false;
  const a = Buffer.from(sig);
  const b = Buffer.from(unsubscribeSig(userId));
  return a.length === b.length && timingSafeEqual(a, b);
}
