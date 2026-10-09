import { BadRequestException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '@/common/prisma/prisma.service';
import { frontendUrl } from '@/config/app.config';
import {
  accessOf,
  canBuy,
  extendedEnd,
  paymentMatches,
  planForPaid,
  PLAN_DAYS,
  PLAN_LABEL,
  plansOf,
  priceOf,
  trialEnd,
  type PlanId,
  type PriceSettings,
  type ProviderId,
} from './billing-rules';
import { flutterwaveCheckout, flutterwaveConfigured, flutterwaveVerify } from './providers/flutterwave';
import { bachsCheckout, bachsConfigured, bachsPaid, bachsSession } from './providers/bachs';

const SETTINGS_ID = 'default';
const DEFAULTS: PriceSettings = { dailyPrice: 200, monthlyPrice: 5000, quarterlyPrice: 10000, trialDays: 2, paywallEnabled: true, currency: 'NGN' };

/**
 * The paywall: a free trial after sign-up, then a paid month or three.
 *
 * A payment is a one-off charge that adds 30 or 90 days; nothing renews on its
 * own, so no card is charged without the user choosing to. Prices, the trial
 * length and the paywall switch live in one settings row edited from Engine
 * controls, so they change without a deploy.
 */
@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);
  private settingsCache: { at: number; value: PriceSettings } | null = null;
  private accessCache = new Map<string, { at: number; allowed: boolean }>();

  constructor(private readonly prisma: PrismaService) {}

  async settings(): Promise<PriceSettings> {
    if (this.settingsCache && Date.now() - this.settingsCache.at < 30_000) return this.settingsCache.value;
    const row = await this.prisma.billingSettings.findUnique({ where: { id: SETTINGS_ID } });
    const value: PriceSettings = row
      ? {
          dailyPrice: row.dailyPrice,
          monthlyPrice: row.monthlyPrice,
          quarterlyPrice: row.quarterlyPrice,
          trialDays: row.trialDays,
          paywallEnabled: row.paywallEnabled,
          currency: row.currency,
        }
      : DEFAULTS;
    this.settingsCache = { at: Date.now(), value };
    return value;
  }

  async updateSettings(input: Partial<PriceSettings>) {
    const clean: Partial<PriceSettings> = {};
    for (const k of ['dailyPrice', 'monthlyPrice', 'quarterlyPrice', 'trialDays'] as const) {
      if (input[k] == null) continue;
      const v = Math.round(Number(input[k]));
      if (!Number.isFinite(v) || v < 0) throw new BadRequestException(`${k} must be a whole number of 0 or more`);
      if (k !== 'trialDays' && v < 100) throw new BadRequestException('A price must be at least 100');
      if (k === 'trialDays' && v > 60) throw new BadRequestException('A trial can be at most 60 days');
      clean[k] = v;
    }
    if (input.paywallEnabled != null) clean.paywallEnabled = !!input.paywallEnabled;
    await this.prisma.billingSettings.upsert({
      where: { id: SETTINGS_ID },
      create: { id: SETTINGS_ID, ...DEFAULTS, ...clean },
      update: clean,
    });
    this.settingsCache = null;
    this.accessCache.clear();
    return this.settings();
  }

  private async user(userId: string) {
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, firstName: true, lastName: true, role: true, createdAt: true, trialEndsAt: true, subscriptionEndsAt: true },
    });
    if (!u) throw new NotFoundException('Account not found');
    return u;
  }

  /** Whether this user may use the app now. Cached for 30 seconds. */
  async allowed(userId: string): Promise<boolean> {
    const hit = this.accessCache.get(userId);
    if (hit && Date.now() - hit.at < 30_000) return hit.allowed;
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true, createdAt: true, trialEndsAt: true, subscriptionEndsAt: true },
    });
    if (!u) return false;
    const { allowed } = accessOf({ ...u, role: String(u.role) }, await this.settings(), new Date());
    this.accessCache.set(userId, { at: Date.now(), allowed });
    return allowed;
  }

  /** What the user holds now, for deciding which plans they may buy. */
  private async buyContext(u: { id: string; role: unknown; createdAt: Date; trialEndsAt: Date | null; subscriptionEndsAt: Date | null }, s: PriceSettings, now: Date) {
    const access = accessOf({ ...u, role: String(u.role) }, s, now);
    const last = await this.prisma.payment.findFirst({
      where: { userId: u.id, status: 'PAID' },
      orderBy: { paidAt: 'desc' },
      select: { plan: true },
    });
    return {
      access,
      ctx: { active: access.state === 'ACTIVE', endsAt: u.subscriptionEndsAt, currentPlan: (last?.plan as PlanId | undefined) ?? null },
    };
  }

  async status(userId: string) {
    const [u, s] = await Promise.all([this.user(userId), this.settings()]);
    const now = new Date();
    const { access, ctx } = await this.buyContext(u, s, now);
    return {
      state: access.state,
      allowed: access.allowed,
      trialEndsAt: trialEnd(u, s.trialDays),
      subscriptionEndsAt: u.subscriptionEndsAt,
      currency: s.currency,
      trialDays: s.trialDays,
      currentPlan: ctx.active ? ctx.currentPlan : null,
      plans: plansOf(s).map((p) => {
        const b = canBuy(p.id, ctx, now);
        return { ...p, buyable: b.ok, note: b.reason ?? null, renewFrom: b.renewFrom ?? null };
      }),
      providers: [
        { id: 'FLUTTERWAVE' as ProviderId, label: 'Flutterwave', methods: 'Card, bank transfer or USSD', available: flutterwaveConfigured() },
        { id: 'BACHS' as ProviderId, label: 'Bachs', methods: 'Card, transfer or stablecoins (USDT, USDC)', available: bachsConfigured() },
      ],
    };
  }

  /** Start a checkout: a pending payment, and the provider's page to send the user to. */
  async checkout(userId: string, plan: PlanId, provider: ProviderId) {
    if (!PLAN_DAYS[plan]) throw new BadRequestException('Unknown plan');
    const u = await this.user(userId);
    const s = await this.settings();
    const { ctx } = await this.buyContext(u, s, new Date());
    const allowedNow = canBuy(plan, ctx, new Date());
    if (!allowedNow.ok) throw new BadRequestException(allowedNow.reason);
    const amount = priceOf(s, plan);
    const reference = `oraql_${randomUUID().replace(/-/g, '')}`;
    const name = [u.firstName, u.lastName].filter(Boolean).join(' ') || null;
    const back = `${frontendUrl()}/billing/return`;

    const payment = await this.prisma.payment.create({
      data: { userId, provider, plan, amount, currency: s.currency, periodDays: PLAN_DAYS[plan], reference },
    });
    this.logger.log(`Checkout ${reference}: ${plan} at ${amount} ${s.currency} via ${provider}`);

    try {
      if (provider === 'FLUTTERWAVE') {
        if (!flutterwaveConfigured()) throw new ServiceUnavailableException('Flutterwave is not set up yet');
        const url = await flutterwaveCheckout({
          reference,
          amount,
          currency: s.currency,
          email: u.email,
          name,
          redirectUrl: `${back}?provider=FLUTTERWAVE&reference=${reference}`,
          description: `OraQL — ${PLAN_LABEL[plan]}`,
        });
        return { url, reference };
      }
      if (provider === 'BACHS') {
        if (!bachsConfigured()) throw new ServiceUnavailableException('Bachs is not set up yet');
        const { url, checkoutId } = await bachsCheckout({
          reference,
          amount,
          currency: s.currency,
          email: u.email,
          name,
          successUrl: `${back}?provider=BACHS&reference=${reference}`,
          cancelUrl: `${frontendUrl()}/subscribe?cancelled=1`,
          plan,
        });
        await this.prisma.payment.update({ where: { id: payment.id }, data: { providerRef: checkoutId } });
        return { url, reference };
      }
      throw new BadRequestException('Unknown payment option');
    } catch (error) {
      await this.prisma.payment.update({ where: { id: payment.id }, data: { status: 'FAILED' } });
      if (error instanceof BadRequestException || error instanceof ServiceUnavailableException) throw error;
      this.logger.error(`Checkout failed (${provider}): ${error instanceof Error ? error.message : error}`);
      throw new ServiceUnavailableException('The payment page could not be opened. Please try again in a moment.');
    }
  }

  /**
   * Check a payment with its provider and, if it is paid, give access. Used by
   * the return page and by both webhooks; safe to call any number of times.
   */
  async confirm(reference: string, userId?: string) {
    const payment = await this.prisma.payment.findUnique({ where: { reference } });
    if (!payment || (userId && payment.userId !== userId)) throw new NotFoundException('Payment not found');
    if (payment.status === 'PAID') return { paid: true, alreadyApplied: true, ...(await this.bought(payment.id, payment.userId)) };

    const expected = { amount: payment.amount, currency: payment.currency };
    let paid = false;
    let providerRef: string | null = payment.providerRef;
    let paidAmount: number | null = null;

    if (payment.provider === 'FLUTTERWAVE') {
      const tx = await flutterwaveVerify(reference);
      if (tx && tx.tx_ref === reference && tx.status === 'successful' && paymentMatches(tx, expected)) {
        paid = true;
        providerRef = String(tx.id);
        paidAmount = Number(tx.amount);
      }
    } else if (payment.provider === 'BACHS' && payment.providerRef) {
      const session = await bachsSession(payment.providerRef);
      if (session && bachsPaid(session) && (session.amount == null || paymentMatches({ amount: session.amount, currency: session.currency ?? payment.currency }, expected))) {
        paid = true;
        paidAmount = session.amount == null ? null : Number(session.amount);
      }
    }

    if (!paid) return { paid: false };
    await this.fulfil(payment.id, providerRef, paidAmount);
    return { paid: true, alreadyApplied: false, ...(await this.bought(payment.id, payment.userId)) };
  }

  /** PENDING → PAID once, then add the plan's days. */
  async fulfil(paymentId: string, providerRef: string | null, paidAmount: number | null = null) {
    const settings = await this.settings();
    await this.prisma.$transaction(async (tx) => {
      const moved = await tx.payment.updateMany({
        where: { id: paymentId, status: { not: 'PAID' } },
        data: { status: 'PAID', paidAt: new Date(), ...(providerRef ? { providerRef } : {}) },
      });
      if (moved.count === 0) return; // already applied by the other path
      const p = await tx.payment.findUniqueOrThrow({ where: { id: paymentId } });
      const buys = planForPaid({ plan: p.plan as PlanId, amount: p.amount }, paidAmount, settings);
      if (buys.corrected) {
        await tx.payment.update({ where: { id: p.id }, data: { plan: buys.plan, periodDays: buys.days, amount: buys.amount } });
        this.logger.warn(`Payment ${p.reference} was recorded as ${p.plan} but ${buys.amount} was paid: applied as ${buys.plan}`);
      }
      const u = await tx.user.findUniqueOrThrow({ where: { id: p.userId }, select: { subscriptionEndsAt: true } });
      await tx.user.update({
        where: { id: p.userId },
        data: { subscriptionEndsAt: extendedEnd(u.subscriptionEndsAt, new Date(), buys.days) },
      });
      this.accessCache.delete(p.userId);
      this.logger.log(`Payment ${p.reference} paid: ${buys.plan} (${buys.amount} ${p.currency}) via ${p.provider}`);
    });
  }

  /** What was bought and when access now ends, for the return page. */
  private async bought(paymentId: string, userId: string) {
    const p = await this.prisma.payment.findUnique({ where: { id: paymentId }, select: { plan: true, amount: true, currency: true } });
    return { plan: p?.plan ?? null, amount: p?.amount ?? null, currency: p?.currency ?? null, ...(await this.endsAt(userId)) };
  }

  private async endsAt(userId: string) {
    const u = await this.prisma.user.findUnique({ where: { id: userId }, select: { subscriptionEndsAt: true } });
    return { subscriptionEndsAt: u?.subscriptionEndsAt ?? null };
  }

  /** Flutterwave's charge.completed: confirmed again with the API, never trusted as sent. */
  async onFlutterwaveEvent(body: { event?: string; data?: { tx_ref?: string; status?: string } }) {
    const ref = body?.data?.tx_ref;
    if (!ref || !ref.startsWith('oraql_')) return { ignored: true };
    if (body.event && body.event !== 'charge.completed') return { ignored: true };
    try {
      return await this.confirm(ref);
    } catch {
      return { ignored: true };
    }
  }

  /** Bachs's checkout.completed (signature already checked by the controller). */
  async onBachsEvent(body: {
    type?: string;
    data?: { reference?: string; checkout_id?: string; status?: string; payment_status?: string; amount?: string; currency?: string };
  }) {
    if (body?.type !== 'checkout.completed' && body?.type !== 'collection.succeeded') return { ignored: true };
    const d = body.data ?? {};
    const payment = d.reference
      ? await this.prisma.payment.findUnique({ where: { reference: d.reference } })
      : d.checkout_id
        ? await this.prisma.payment.findFirst({ where: { providerRef: d.checkout_id, provider: 'BACHS' } })
        : null;
    if (!payment) return { ignored: true };
    if (body.type === 'checkout.completed' && !bachsPaid(d)) return { ignored: true };
    if (d.amount != null && !paymentMatches({ amount: d.amount, currency: d.currency ?? payment.currency }, payment)) {
      this.logger.warn(`Bachs event for ${payment.reference} did not match the price; not applied`);
      return { ignored: true };
    }
    await this.fulfil(payment.id, d.checkout_id ?? payment.providerRef, d.amount == null ? null : Number(d.amount));
    return { paid: true };
  }

  /** The latest payments, for Engine controls. */
  async recentPayments(limit = 50) {
    const rows = await this.prisma.payment.findMany({
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 200),
      select: {
        reference: true, provider: true, plan: true, amount: true, currency: true, status: true, createdAt: true, paidAt: true,
        user: { select: { email: true } },
      },
    });
    const since = new Date(Date.now() - 30 * 86_400_000);
    const paid30 = await this.prisma.payment.aggregate({ where: { status: 'PAID', paidAt: { gte: since } }, _sum: { amount: true }, _count: true });
    const activeSubscribers = await this.prisma.user.count({ where: { subscriptionEndsAt: { gt: new Date() } } });
    return { payments: rows, last30Days: { paid: paid30._count, revenue: paid30._sum.amount ?? 0 }, activeSubscribers };
  }
}
