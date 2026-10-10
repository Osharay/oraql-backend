import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '@/common/prisma/prisma.service';
import { frontendUrl } from '@/config/app.config';
import { PLAN_LABEL, type PlanId } from '@/modules/billing/billing-rules';
import { resendBatch, resendConfigured, resendOne, type OutgoingEmail } from './resend';
import { hashToken, newToken, unsubscribeOk, unsubscribeSig } from './mail-tokens';
import {
  endingEmail,
  messageEmail,
  passwordChangedEmail,
  receiptEmail,
  resetEmail,
  verifyEmail,
  welcomeEmail,
  type Email,
} from './templates';

const HOUR = 3_600_000;
const VERIFY_TTL = 72 * HOUR;
const RESET_TTL = 1 * HOUR;
const BATCH = 100;

/** Dates in emails are shown in Nigerian time, where OraQL's users are. */
export const fmtWhen = (d: Date) =>
  `${d.toLocaleString('en-GB', {
    timeZone: 'Africa/Lagos',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })} (WAT)`;

const naira = (n: number, currency = 'NGN') => (currency === 'NGN' ? `₦${n.toLocaleString('en-NG')}` : `${currency} ${n.toLocaleString()}`);

export interface CampaignInput {
  subject: string;
  body: string;
  buttonText?: string | null;
  buttonUrl?: string | null;
  audience: 'ALL' | 'ONE';
  toEmail?: string | null;
}

/**
 * Every email OraQL sends, through Resend: account emails (welcome and
 * confirm, password reset, password changed), payment receipts, the trial and
 * subscription reminders, and the newsletters and one-off messages written in
 * Engine controls. A failed send is logged and never breaks the action that
 * triggered it (signing up, paying).
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(private readonly prisma: PrismaService) {}

  private site = () => frontendUrl();

  private async deliver(to: string, email: Email, tag: string, headers?: Record<string, string>) {
    if (!resendConfigured()) {
      this.logger.warn(`Email "${tag}" to ${to} not sent: RESEND_API_KEY is not set`);
      return false;
    }
    try {
      await resendOne({ to, ...email, headers, tags: [{ name: 'type', value: tag }] });
      return true;
    } catch (e) {
      this.logger.error(`Email "${tag}" to ${to} failed: ${e instanceof Error ? e.message : e}`);
      return false;
    }
  }

  private async issueToken(userId: string, type: 'VERIFY_EMAIL' | 'RESET_PASSWORD', ttl: number) {
    // One live link per purpose: a new one replaces the old.
    await this.prisma.authToken.updateMany({ where: { userId, type, usedAt: null }, data: { usedAt: new Date() } });
    const { token, hash } = newToken();
    await this.prisma.authToken.create({ data: { userId, type, tokenHash: hash, expiresAt: new Date(Date.now() + ttl) } });
    return token;
  }

  private async useToken(token: string, type: 'VERIFY_EMAIL' | 'RESET_PASSWORD') {
    const row = await this.prisma.authToken.findUnique({ where: { tokenHash: hashToken(token) } });
    if (!row || row.type !== type || row.usedAt || row.expiresAt < new Date()) return null;
    const used = await this.prisma.authToken.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: new Date() } });
    return used.count ? row : null;
  }

  // ─── Account ───

  /** After sign-up: welcome, with the link to confirm the address. */
  async welcome(userId: string) {
    const u = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!u) return;
    const settings = await this.prisma.billingSettings.findUnique({ where: { id: 'default' } });
    const token = await this.issueToken(u.id, 'VERIFY_EMAIL', VERIFY_TTL);
    await this.deliver(
      u.email,
      welcomeEmail({ name: u.firstName, verifyUrl: `${this.site()}/auth/verify?token=${token}`, trialDays: settings?.trialDays ?? 2, siteUrl: this.site() }),
      'welcome',
    );
  }

  async resendVerification(userId: string) {
    const u = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!u) return { sent: false };
    if (u.emailVerified) return { sent: false, alreadyVerified: true };
    const token = await this.issueToken(u.id, 'VERIFY_EMAIL', VERIFY_TTL);
    const sent = await this.deliver(u.email, verifyEmail({ name: u.firstName, verifyUrl: `${this.site()}/auth/verify?token=${token}`, siteUrl: this.site() }), 'verify');
    return { sent };
  }

  async verify(token: string) {
    const row = await this.useToken(token, 'VERIFY_EMAIL');
    if (!row) throw new BadRequestException('This link has expired or was already used. Sign in and ask for a new one.');
    await this.prisma.user.update({ where: { id: row.userId }, data: { emailVerified: true } });
    return { verified: true };
  }

  /** Always answers the same way, so it never reveals whether an email has an account. */
  async forgotPassword(email: string) {
    const u = await this.prisma.user.findFirst({ where: { email: { equals: email.trim(), mode: 'insensitive' } } });
    if (u && u.isActive) {
      const token = await this.issueToken(u.id, 'RESET_PASSWORD', RESET_TTL);
      await this.deliver(u.email, resetEmail({ name: u.firstName, resetUrl: `${this.site()}/auth/reset?token=${token}`, siteUrl: this.site() }), 'reset');
    }
    return { ok: true };
  }

  async resetPassword(token: string, password: string) {
    if (!password || password.length < 8) throw new BadRequestException('Password must be at least 8 characters');
    const row = await this.useToken(token, 'RESET_PASSWORD');
    if (!row) throw new BadRequestException('This reset link has expired or was already used. Ask for a new one.');
    const passwordHash = await bcrypt.hash(password, 12);
    // A new password signs every device out; the link also proves the address.
    const u = await this.prisma.user.update({
      where: { id: row.userId },
      data: { passwordHash, refreshToken: null, emailVerified: true },
    });
    await this.deliver(u.email, passwordChangedEmail({ name: u.firstName, siteUrl: this.site(), when: fmtWhen(new Date()) }), 'password-changed');
    return { ok: true };
  }

  // ─── Payments ───

  async receipt(paymentId: string) {
    const p = await this.prisma.payment.findUnique({ where: { id: paymentId }, include: { user: true } });
    if (!p || p.status !== 'PAID' || !p.user.subscriptionEndsAt) return;
    await this.deliver(
      p.user.email,
      receiptEmail({
        name: p.user.firstName,
        plan: PLAN_LABEL[p.plan as PlanId] ?? p.plan,
        amount: naira(p.amount, p.currency),
        provider: p.provider === 'BACHS' ? 'Bachs' : 'Flutterwave',
        reference: p.reference,
        until: fmtWhen(p.user.subscriptionEndsAt),
        siteUrl: this.site(),
      }),
      'receipt',
    );
  }

  // ─── Reminders: once, about a day before access ends ───

  @Cron('5 * * * *', { name: 'access-ending-reminders', timeZone: 'UTC' })
  async remindEnding() {
    if (!resendConfigured()) return;
    const settings = await this.prisma.billingSettings.findUnique({ where: { id: 'default' } });
    if (settings && !settings.paywallEnabled) return;
    const now = new Date();
    const soon = new Date(now.getTime() + 24 * HOUR);
    const trialDays = settings?.trialDays ?? 2;

    // Paid periods ending in the next day (not day passes: a day is all they are).
    const paid = await this.prisma.user.findMany({
      where: { role: 'USER', isActive: true, subscriptionEndsAt: { gt: now, lte: soon } },
      select: { id: true, email: true, firstName: true, subscriptionEndsAt: true, reminderSentFor: true },
      take: 500,
    });
    for (const u of paid) {
      if (u.reminderSentFor?.getTime() === u.subscriptionEndsAt!.getTime()) continue;
      const last = await this.prisma.payment.findFirst({ where: { userId: u.id, status: 'PAID' }, orderBy: { paidAt: 'desc' }, select: { periodDays: true } });
      if (!last || last.periodDays <= 1) continue;
      const ok = await this.deliver(u.email, endingEmail({ name: u.firstName, kind: 'subscription', until: fmtWhen(u.subscriptionEndsAt!), siteUrl: this.site() }), 'ending-subscription');
      if (ok) await this.prisma.user.update({ where: { id: u.id }, data: { reminderSentFor: u.subscriptionEndsAt } });
    }

    // Free trials ending in the next day, for people who have not paid.
    const trial = await this.prisma.user.findMany({
      where: {
        role: 'USER',
        isActive: true,
        OR: [{ subscriptionEndsAt: null }, { subscriptionEndsAt: { lte: now } }],
        AND: [
          {
            OR: [
              { trialEndsAt: { gt: now, lte: soon } },
              { trialEndsAt: null, createdAt: { gt: new Date(now.getTime() - trialDays * 24 * HOUR), lte: new Date(soon.getTime() - trialDays * 24 * HOUR) } },
            ],
          },
        ],
      },
      select: { id: true, email: true, firstName: true, trialEndsAt: true, createdAt: true, reminderSentFor: true },
      take: 500,
    });
    for (const u of trial) {
      const ends = u.trialEndsAt ?? new Date(u.createdAt.getTime() + trialDays * 24 * HOUR);
      if (u.reminderSentFor?.getTime() === ends.getTime()) continue;
      const ok = await this.deliver(u.email, endingEmail({ name: u.firstName, kind: 'trial', until: fmtWhen(ends), siteUrl: this.site() }), 'ending-trial');
      if (ok) await this.prisma.user.update({ where: { id: u.id }, data: { reminderSentFor: ends } });
    }
  }

  // ─── Newsletters and messages from Engine controls ───

  unsubscribeUrl(userId: string) {
    return `${this.site()}/unsubscribe?u=${encodeURIComponent(userId)}&s=${unsubscribeSig(userId)}`;
  }

  async unsubscribe(userId: string, sig: string) {
    if (!unsubscribeOk(userId, sig)) throw new BadRequestException('This unsubscribe link is not valid');
    await this.prisma.user.updateMany({ where: { id: userId }, data: { emailOptOut: true } });
    return { unsubscribed: true };
  }

  private campaignEmail(c: CampaignInput, to: { id?: string; firstName?: string | null } | null) {
    const newsletter = c.audience === 'ALL';
    return messageEmail({
      subject: c.subject,
      body: c.body,
      name: to ? to.firstName ?? null : null,
      buttonText: c.buttonText,
      buttonUrl: c.buttonUrl,
      unsubscribeUrl: newsletter && to?.id ? this.unsubscribeUrl(to.id) : newsletter ? `${this.site()}/unsubscribe` : null,
      siteUrl: this.site(),
    });
  }

  private check(c: CampaignInput) {
    if (!c.subject?.trim() || !c.body?.trim()) throw new BadRequestException('A subject and a message are needed');
    if (c.buttonUrl && !/^https?:\/\//.test(c.buttonUrl)) throw new BadRequestException('The button link must start with https://');
    if (c.audience === 'ONE' && !c.toEmail?.trim()) throw new BadRequestException('Enter the email address to send to');
  }

  preview(c: CampaignInput) {
    this.check({ ...c, toEmail: c.toEmail || 'preview@oraql.live' });
    return { html: this.campaignEmail(c, { id: 'preview', firstName: 'Ada' }).html };
  }

  /** Send the email to the admin only, marked as a test. */
  async test(adminId: string, c: CampaignInput) {
    this.check({ ...c, toEmail: c.toEmail || 'test' });
    const me = await this.prisma.user.findUnique({ where: { id: adminId } });
    if (!me) throw new BadRequestException('Account not found');
    const email = this.campaignEmail(c, me);
    const sent = await this.deliver(me.email, { ...email, subject: `[Test] ${email.subject}` }, 'campaign-test');
    if (!sent) throw new BadRequestException(resendConfigured() ? 'The test email could not be sent; see the server log.' : 'Email is not set up yet: add RESEND_API_KEY in Railway.');
    return { sentTo: me.email };
  }

  async recipientCount() {
    const all = await this.prisma.user.count({ where: { isActive: true } });
    const optedOut = await this.prisma.user.count({ where: { isActive: true, emailOptOut: true } });
    return { all, optedOut, willReceive: all - optedOut };
  }

  /**
   * Start sending. The campaign row is created straight away and the emails go
   * out in batches of 100 in the background; its counts update as they do.
   */
  async send(adminId: string, c: CampaignInput) {
    this.check(c);
    if (!resendConfigured()) throw new BadRequestException('Email is not set up yet: add RESEND_API_KEY in Railway.');
    const recipients =
      c.audience === 'ONE'
        ? [
            (await this.prisma.user.findFirst({
              where: { email: { equals: c.toEmail!.trim(), mode: 'insensitive' } },
              select: { id: true, email: true, firstName: true },
            })) ?? {
              id: undefined,
              email: c.toEmail!.trim().toLowerCase(),
              firstName: null,
            },
          ]
        : await this.prisma.user.findMany({ where: { isActive: true, emailOptOut: false }, select: { id: true, email: true, firstName: true } });

    const campaign = await this.prisma.emailCampaign.create({
      data: {
        subject: c.subject.trim(),
        body: c.body,
        buttonText: c.buttonText || null,
        buttonUrl: c.buttonUrl || null,
        audience: c.audience,
        toEmail: c.audience === 'ONE' ? c.toEmail!.trim().toLowerCase() : null,
        recipients: recipients.length,
        createdBy: adminId,
      },
    });

    void this.sendInBatches(campaign.id, c, recipients);
    return campaign;
  }

  private async sendInBatches(campaignId: string, c: CampaignInput, recipients: Array<{ id?: string; email: string; firstName: string | null }>) {
    let sent = 0;
    let failed = 0;
    for (let i = 0; i < recipients.length; i += BATCH) {
      const chunk = recipients.slice(i, i + BATCH);
      const emails: OutgoingEmail[] = chunk.map((r) => {
        const e = this.campaignEmail(c, r);
        const unsub = c.audience === 'ALL' && r.id ? this.unsubscribeUrl(r.id) : null;
        return {
          to: r.email,
          ...e,
          tags: [{ name: 'type', value: c.audience === 'ALL' ? 'newsletter' : 'message' }],
          ...(unsub ? { headers: { 'List-Unsubscribe': `<${unsub}>` } } : {}),
        };
      });
      try {
        await resendBatch(emails);
        sent += chunk.length;
      } catch (e) {
        failed += chunk.length;
        this.logger.error(`Campaign ${campaignId}: a batch of ${chunk.length} failed: ${e instanceof Error ? e.message : e}`);
      }
      await this.prisma.emailCampaign.update({ where: { id: campaignId }, data: { sent, failed } });
      if (i + BATCH < recipients.length) await new Promise((r) => setTimeout(r, 700)); // stay under Resend's rate limit
    }
    await this.prisma.emailCampaign.update({
      where: { id: campaignId },
      data: { status: sent > 0 || recipients.length === 0 ? 'SENT' : 'FAILED', finishedAt: new Date() },
    });
  }

  campaigns(limit = 30) {
    return this.prisma.emailCampaign.findMany({ orderBy: { createdAt: 'desc' }, take: Math.min(limit, 100) });
  }
}
