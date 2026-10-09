import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Who can use OraQL, and what a payment buys — pure, so it is tested without
 * a database or a provider.
 *
 * Access: admins and comp (PREMIUM) accounts always; everyone else during the
 * free trial or a paid period. Each payment buys a fixed number of days added
 * to whatever is left, so paying early never loses days.
 */

export type PlanId = 'MONTHLY' | 'QUARTERLY';
export type ProviderId = 'FLUTTERWAVE' | 'BACHS';
export type AccessState = 'ADMIN' | 'COMP' | 'OFF' | 'TRIAL' | 'ACTIVE' | 'EXPIRED';

export const PLAN_DAYS: Record<PlanId, number> = { MONTHLY: 30, QUARTERLY: 90 };
export const PLAN_LABEL: Record<PlanId, string> = { MONTHLY: '1 month', QUARTERLY: '3 months' };

export interface PriceSettings {
  monthlyPrice: number;
  quarterlyPrice: number;
  trialDays: number;
  paywallEnabled: boolean;
  currency: string;
}

export interface AccessUser {
  role: string;
  createdAt: Date;
  trialEndsAt: Date | null;
  subscriptionEndsAt: Date | null;
}

/** When the free trial ends: as stored, or sign-up plus the trial length. */
export function trialEnd(u: AccessUser, trialDays: number): Date {
  return u.trialEndsAt ?? new Date(u.createdAt.getTime() + trialDays * 86_400_000);
}

export function accessOf(u: AccessUser, s: PriceSettings, now: Date): { state: AccessState; allowed: boolean; until: Date | null } {
  if (u.role === 'ADMIN') return { state: 'ADMIN', allowed: true, until: null };
  if (u.role === 'PREMIUM') return { state: 'COMP', allowed: true, until: null };
  if (!s.paywallEnabled) return { state: 'OFF', allowed: true, until: null };
  if (u.subscriptionEndsAt && u.subscriptionEndsAt > now) return { state: 'ACTIVE', allowed: true, until: u.subscriptionEndsAt };
  const trial = trialEnd(u, s.trialDays);
  if (trial > now) return { state: 'TRIAL', allowed: true, until: trial };
  return { state: 'EXPIRED', allowed: false, until: null };
}

/** A paid period starts now, or where the current one ends if later. */
export function extendedEnd(current: Date | null, now: Date, days: number): Date {
  const from = current && current > now ? current : now;
  return new Date(from.getTime() + days * 86_400_000);
}

/** In the last few days of a paid period the user may renew early. */
export const RENEW_WINDOW_DAYS = 3;

export interface BuyContext {
  /** True only while a paid period is running (not trial, admin or comp). */
  active: boolean;
  endsAt: Date | null;
  /** The plan of the latest paid payment. */
  currentPlan: PlanId | null;
}

/**
 * Whether a plan can be bought now. Anyone without a running paid period can
 * buy either plan. While one runs, the only purchases are an upgrade from the
 * month to three months, or a renewal in the last few days — so nobody pays
 * twice for time they already have. Bought days still go on top of what is left.
 */
export function canBuy(plan: PlanId, c: BuyContext, now: Date): { ok: boolean; reason?: string; renewFrom?: Date } {
  if (!c.active || !c.endsAt || c.endsAt <= now) return { ok: true };
  const renewFrom = new Date(c.endsAt.getTime() - RENEW_WINDOW_DAYS * 86_400_000);
  if (now >= renewFrom) return { ok: true };
  if (plan === 'QUARTERLY' && c.currentPlan === 'MONTHLY') return { ok: true };
  return {
    ok: false,
    renewFrom,
    reason:
      plan === 'MONTHLY' && c.currentPlan === 'MONTHLY'
        ? 'You are already on the monthly plan. You can renew in its last 3 days, or upgrade to 3 months now.'
        : 'You already have an active subscription. You can renew in its last 3 days.',
  };
}

export function priceOf(s: PriceSettings, plan: PlanId): number {
  return plan === 'MONTHLY' ? s.monthlyPrice : s.quarterlyPrice;
}

export function plansOf(s: PriceSettings) {
  const monthlyFor3 = s.monthlyPrice * 3;
  return (['MONTHLY', 'QUARTERLY'] as PlanId[]).map((id) => ({
    id,
    label: PLAN_LABEL[id],
    price: priceOf(s, id),
    days: PLAN_DAYS[id],
    saving: id === 'QUARTERLY' && monthlyFor3 > s.quarterlyPrice ? monthlyFor3 - s.quarterlyPrice : 0,
  }));
}

/** Whether a provider's report of a payment covers what was asked. */
export function paymentMatches(
  reported: { amount: number | string; currency: string },
  expected: { amount: number; currency: string },
): boolean {
  return Number(reported.amount) >= expected.amount && String(reported.currency).toUpperCase() === expected.currency.toUpperCase();
}

const safeEqual = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/** Flutterwave sends the secret hash set on the dashboard in `verif-hash`. */
export function flutterwaveSignatureOk(header: string | undefined, secretHash: string | undefined): boolean {
  if (!header || !secretHash) return false;
  return safeEqual(header, secretHash);
}

/**
 * Bachs signs `${timestamp}.${rawBody}` with HMAC-SHA256 (hex). The V2 header
 * is `t=<ts>,v1=<sig>[,v1=<sig>]` — several during a secret rotation, any one
 * may match; the V1 header is the bare digest beside X-Bachs-Timestamp.
 * Deliveries more than five minutes old are refused.
 */
export function bachsSignatureOk(
  headers: { signatureV2?: string; signature?: string; timestamp?: string },
  rawBody: Buffer | string,
  secret: string | undefined,
  now: Date,
  toleranceSec = 300,
): boolean {
  if (!secret) return false;
  let ts = headers.timestamp;
  let candidates: string[] = headers.signature ? [headers.signature] : [];
  if (headers.signatureV2) {
    const parts = headers.signatureV2.split(',').map((p) => p.trim());
    ts = parts.find((p) => p.startsWith('t='))?.slice(2) ?? ts;
    candidates = parts.filter((p) => p.startsWith('v1=')).map((p) => p.slice(3));
  }
  if (!ts || candidates.length === 0) return false;
  if (Math.abs(now.getTime() / 1000 - Number(ts)) > toleranceSec) return false;
  const expected = createHmac('sha256', secret).update(`${ts}.`).update(rawBody).digest('hex');
  return candidates.some((c) => safeEqual(c, expected));
}
