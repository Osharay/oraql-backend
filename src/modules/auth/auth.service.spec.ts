// bcrypt is a native module and only used here for passwords; not under test.
jest.mock('bcrypt', () => ({ hash: jest.fn(), compare: jest.fn() }));

import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { AuthService, JwtPayload } from './auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { hashToken, tokenMatches } from './token-hash';

const SECRET = 'access-secret-for-tests';
const REFRESH_SECRET = 'refresh-secret-for-tests';
const USER_ID = '3f1c2a9e-7b4d-4e2a-9c1f-5a6b7c8d9e0f';

function setup() {
  const values: Record<string, string> = {
    'jwt.secret': SECRET,
    'jwt.refreshSecret': REFRESH_SECRET,
    'jwt.accessExpiration': '15m',
    'jwt.refreshExpiration': '30d',
  };
  const config = { get: (k: string, d?: string) => values[k] ?? d } as unknown as ConfigService;
  const jwt = new JwtService({ secret: SECRET });

  const user = { id: USER_ID, email: 'victim@example.com', role: 'ADMIN', refreshToken: null as string | null };
  const users = {
    findById: jest.fn(async (id: string) => (id === user.id ? user : null)),
    updateRefreshToken: jest.fn(async (_id: string, token: string | null) => {
      user.refreshToken = token ? hashToken(token) : null;
    }),
  };

  const auth = new AuthService(users as any, jwt, config);
  const strategy = new JwtStrategy(config);
  return { auth, jwt, user, strategy };
}

/** The forgery from the review: header + start of the victim's id, then junk. */
function forgedFromId(id: string): string {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: id, email: 'x' })}`.slice(0, 72) + 'junk';
}

describe('refresh token security', () => {
  it('refuses a token forged from a user id', async () => {
    const { auth } = setup();
    await auth.login(USER_ID, 'victim@example.com', 'ADMIN');
    await expect(auth.refreshTokens(forgedFromId(USER_ID))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('no longer accepts a caller-supplied user id', async () => {
    const { auth } = setup();
    await auth.login(USER_ID, 'victim@example.com', 'ADMIN');
    // Extra argument ignored: the signature takes the token alone.
    await expect(
      (auth.refreshTokens as any)(forgedFromId(USER_ID), USER_ID),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('refreshes with the real token, and rotates it', async () => {
    const { auth } = setup();
    const first = await auth.login(USER_ID, 'victim@example.com', 'ADMIN');
    const second = await auth.refreshTokens(first.refreshToken);
    expect(second.accessToken).toBeTruthy();
    expect(second.refreshToken).not.toBe(first.refreshToken);
    // The used token is spent.
    await expect(auth.refreshTokens(first.refreshToken)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('will not refresh with an access token', async () => {
    const { auth } = setup();
    const tokens = await auth.login(USER_ID, 'victim@example.com', 'ADMIN');
    await expect(auth.refreshTokens(tokens.accessToken)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('signs refresh tokens with their own key', async () => {
    const { auth, jwt } = setup();
    const tokens = await auth.login(USER_ID, 'victim@example.com', 'ADMIN');
    await expect(jwt.verifyAsync(tokens.refreshToken)).rejects.toThrow();
    const payload = await jwt.verifyAsync<JwtPayload>(tokens.accessToken);
    expect(payload.typ).toBe('access');
  });

  it('the API rejects anything but an access token', () => {
    const { strategy } = setup();
    const base = { sub: USER_ID, email: 'e', role: 'USER' };
    expect(strategy.validate({ ...base, typ: 'access' })).toMatchObject({ sub: USER_ID });
    expect(() => strategy.validate({ ...base, typ: 'refresh' })).toThrow(UnauthorizedException);
    // Tokens issued before types existed are refused too.
    expect(() => strategy.validate(base as any)).toThrow(UnauthorizedException);
  });
});

describe('token hashing', () => {
  it('reads the whole token, not the first 72 bytes', () => {
    const token = 'a'.repeat(72) + 'real-ending';
    const stored = hashToken(token);
    expect(tokenMatches(token, stored)).toBe(true);
    expect(tokenMatches('a'.repeat(72) + 'other-ending', stored)).toBe(false);
  });

  it('does not match a leftover bcrypt hash or nothing', () => {
    expect(tokenMatches('anything', '$2b$10$abcdefghijklmnopqrstuv')).toBe(false);
    expect(tokenMatches('anything', null)).toBe(false);
  });
});
