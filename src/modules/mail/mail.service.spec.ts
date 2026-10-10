jest.mock('./resend', () => ({
  resendConfigured: () => true,
  resendOne: jest.fn(async () => undefined),
  resendBatch: jest.fn(async () => undefined),
}));

import * as bcrypt from 'bcrypt';
import { MailService } from './mail.service';
import { resendBatch, resendOne } from './resend';

function fakePrisma() {
  const users = new Map<string, any>([
    ['u1', { id: 'u1', email: 'Ada@Example.com', firstName: 'Ada', isActive: true, emailVerified: false, emailOptOut: false, passwordHash: 'old', refreshToken: 'r' }],
    ['u2', { id: 'u2', email: 'bo@example.com', firstName: null, isActive: true, emailVerified: true, emailOptOut: true }],
  ]);
  const tokens: any[] = [];
  const campaigns: any[] = [];
  const match = (row: any, where: any) =>
    Object.entries(where).every(([k, v]: [string, any]) =>
      v && typeof v === 'object' && 'equals' in v ? String(row[k]).toLowerCase() === String(v.equals).toLowerCase() : row[k] === v,
    );
  const prisma: any = {
    billingSettings: { findUnique: async () => null },
    user: {
      findUnique: async ({ where }: any) => users.get(where.id) ?? null,
      findFirst: async ({ where }: any) => [...users.values()].find((u) => match(u, where)) ?? null,
      findMany: async ({ where }: any) => [...users.values()].filter((u) => match(u, where)),
      update: async ({ where, data }: any) => Object.assign(users.get(where.id), data),
      updateMany: async ({ where, data }: any) => { const u = users.get(where.id); if (u) Object.assign(u, data); return { count: u ? 1 : 0 }; },
    },
    authToken: {
      updateMany: async ({ where, data }: any) => {
        const hit = tokens.filter((t) => (where.id ? t.id === where.id : t.userId === where.userId && t.type === where.type) && t.usedAt === null);
        hit.forEach((t) => Object.assign(t, data));
        return { count: hit.length };
      },
      create: async ({ data }: any) => { const t = { id: `t${tokens.length}`, usedAt: null, ...data }; tokens.push(t); return t; },
      findUnique: async ({ where }: any) => tokens.find((t) => t.tokenHash === where.tokenHash) ?? null,
    },
    emailCampaign: {
      create: async ({ data }: any) => { const c = { id: 'c1', ...data }; campaigns.push(c); return c; },
      update: async ({ data }: any) => Object.assign(campaigns[0], data),
    },
  };
  return { prisma, users, tokens, campaigns };
}

const linkToken = (call: any) => /token=([A-Za-z0-9_-]+)/.exec(call[0].html)![1];

describe('MailService', () => {
  beforeEach(() => (resendOne as jest.Mock).mockClear());

  it('resets a password once with the emailed link, signs devices out, and refuses the link again', async () => {
    const { prisma, users } = fakePrisma();
    const mail = new MailService(prisma);
    await mail.forgotPassword('ada@example.com'); // any case
    expect(resendOne).toHaveBeenCalledTimes(1);
    const token = linkToken((resendOne as jest.Mock).mock.calls[0]);

    await mail.resetPassword(token, 'new-password-1');
    const u = users.get('u1');
    expect(await bcrypt.compare('new-password-1', u.passwordHash)).toBe(true);
    expect(u.refreshToken).toBeNull();
    await expect(mail.resetPassword(token, 'another-pass')).rejects.toThrow('expired or was already used');
  });

  it('says nothing about addresses with no account', async () => {
    const { prisma } = fakePrisma();
    const mail = new MailService(prisma);
    expect(await mail.forgotPassword('nobody@example.com')).toEqual({ ok: true });
    expect(resendOne).not.toHaveBeenCalled();
  });

  it('confirms an email with the welcome link; a newer link replaces the older one', async () => {
    const { prisma, users } = fakePrisma();
    const mail = new MailService(prisma);
    await mail.welcome('u1');
    const first = linkToken((resendOne as jest.Mock).mock.calls[0]);
    await mail.resendVerification('u1');
    const second = linkToken((resendOne as jest.Mock).mock.calls[1]);
    await expect(mail.verify(first)).rejects.toThrow();
    await mail.verify(second);
    expect(users.get('u1').emailVerified).toBe(true);
  });

  it('a newsletter skips people who unsubscribed', async () => {
    const { prisma, campaigns } = fakePrisma();
    const mail = new MailService(prisma);
    await mail.send('u1', { subject: 'Week 1', body: 'Hello', audience: 'ALL' });
    await new Promise((r) => setTimeout(r, 20));
    const sentTo = (resendBatch as jest.Mock).mock.calls[0][0].map((e: any) => e.to);
    expect(sentTo).toEqual(['Ada@Example.com']);
    expect(campaigns[0]).toMatchObject({ recipients: 1, sent: 1, status: 'SENT' });
    expect((resendBatch as jest.Mock).mock.calls[0][0][0].headers['List-Unsubscribe']).toContain('/unsubscribe?u=u1');
  });
});
