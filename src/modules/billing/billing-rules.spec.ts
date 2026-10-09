import { createHmac } from 'crypto';
import { accessOf, bachsSignatureOk, extendedEnd, flutterwaveSignatureOk, paymentMatches, plansOf } from './billing-rules';

const settings = { monthlyPrice: 5000, quarterlyPrice: 10000, trialDays: 2, paywallEnabled: true, currency: 'NGN' };
const now = new Date('2026-10-09T12:00:00Z');
const day = 86_400_000;
const user = (o: Partial<{ role: string; createdAt: Date; trialEndsAt: Date | null; subscriptionEndsAt: Date | null }> = {}) => ({
  role: 'USER',
  createdAt: new Date(now.getTime() - day),
  trialEndsAt: null,
  subscriptionEndsAt: null,
  ...o,
});

describe('access', () => {
  it('gives a new sign-up two days', () => {
    expect(accessOf(user(), settings, now).state).toBe('TRIAL');
    expect(accessOf(user({ createdAt: new Date(now.getTime() - 3 * day) }), settings, now).state).toBe('EXPIRED');
  });

  it('honours a stored trial end over the sign-up date', () => {
    const u = user({ createdAt: new Date('2026-01-01'), trialEndsAt: new Date(now.getTime() + day) });
    expect(accessOf(u, settings, now).state).toBe('TRIAL');
  });

  it('opens for a paid period, and closes after it', () => {
    const paid = user({ createdAt: new Date('2026-01-01'), subscriptionEndsAt: new Date(now.getTime() + day) });
    expect(accessOf(paid, settings, now)).toMatchObject({ state: 'ACTIVE', allowed: true });
    const lapsed = user({ createdAt: new Date('2026-01-01'), subscriptionEndsAt: new Date(now.getTime() - day) });
    expect(accessOf(lapsed, settings, now)).toMatchObject({ state: 'EXPIRED', allowed: false });
  });

  it('never locks admins or comp accounts, and opens everyone when the paywall is off', () => {
    const old = { createdAt: new Date('2026-01-01') };
    expect(accessOf(user({ ...old, role: 'ADMIN' }), settings, now).allowed).toBe(true);
    expect(accessOf(user({ ...old, role: 'PREMIUM' }), settings, now).state).toBe('COMP');
    expect(accessOf(user(old), { ...settings, paywallEnabled: false }, now).state).toBe('OFF');
  });
});

describe('a payment', () => {
  it('adds its days to what is left, never losing days', () => {
    expect(extendedEnd(null, now, 30).getTime()).toBe(now.getTime() + 30 * day);
    const left = new Date(now.getTime() + 5 * day);
    expect(extendedEnd(left, now, 30).getTime()).toBe(now.getTime() + 35 * day);
    expect(extendedEnd(new Date(now.getTime() - 5 * day), now, 90).getTime()).toBe(now.getTime() + 90 * day);
  });

  it('must cover the price in the right currency', () => {
    expect(paymentMatches({ amount: '5000.00', currency: 'ngn' }, { amount: 5000, currency: 'NGN' })).toBe(true);
    expect(paymentMatches({ amount: 4999, currency: 'NGN' }, { amount: 5000, currency: 'NGN' })).toBe(false);
    expect(paymentMatches({ amount: 5000, currency: 'USD' }, { amount: 5000, currency: 'NGN' })).toBe(false);
  });

  it('shows the three-month saving', () => {
    expect(plansOf(settings).find((p) => p.id === 'QUARTERLY')?.saving).toBe(5000);
  });
});

describe('webhook signatures', () => {
  it('Flutterwave: the secret hash must match exactly', () => {
    expect(flutterwaveSignatureOk('abc123', 'abc123')).toBe(true);
    expect(flutterwaveSignatureOk('abc124', 'abc123')).toBe(false);
    expect(flutterwaveSignatureOk(undefined, 'abc123')).toBe(false);
    expect(flutterwaveSignatureOk('abc123', undefined)).toBe(false);
  });

  it('Bachs: HMAC of timestamp and raw body, fresh, any rotated signature', () => {
    const secret = 'whsec_test';
    const body = '{"type":"checkout.completed","data":{"reference":"oraql_1"}}';
    const ts = String(Math.floor(now.getTime() / 1000));
    const sig = createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex');
    expect(bachsSignatureOk({ signatureV2: `t=${ts},v1=${sig}` }, body, secret, now)).toBe(true);
    expect(bachsSignatureOk({ signatureV2: `t=${ts},v1=deadbeef,v1=${sig}` }, body, secret, now)).toBe(true);
    expect(bachsSignatureOk({ signature: sig, timestamp: ts }, Buffer.from(body), secret, now)).toBe(true);
    expect(bachsSignatureOk({ signatureV2: `t=${ts},v1=${sig}` }, body.replace('oraql_1', 'oraql_2'), secret, now)).toBe(false);
    const late = new Date(now.getTime() + 10 * 60_000);
    expect(bachsSignatureOk({ signatureV2: `t=${ts},v1=${sig}` }, body, secret, late)).toBe(false);
    expect(bachsSignatureOk({ signatureV2: `t=${ts},v1=${sig}` }, body, undefined, now)).toBe(false);
  });
});

describe('Bachs headers under either name', () => {
  const { bachsHeaders } = jest.requireActual('./billing.controller');
  const secret = 'whsec_test';
  const body = '{"type":"checkout.completed"}';
  const now = new Date();
  const ts = String(Math.floor(now.getTime() / 1000));
  const sig = createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex');

  it('reads the documented X- headers', () => {
    expect(bachsSignatureOk(bachsHeaders({ 'x-bachs-signature-v2': `t=${ts},v1=${sig}` }), body, secret, now)).toBe(true);
    expect(bachsSignatureOk(bachsHeaders({ 'x-bachs-signature': sig, 'x-bachs-timestamp': ts }), body, secret, now)).toBe(true);
  });

  it('reads the portal\'s Bachs-Signature, in either layout', () => {
    expect(bachsSignatureOk(bachsHeaders({ 'bachs-signature': `t=${ts},v1=${sig}` }), body, secret, now)).toBe(true);
    expect(bachsSignatureOk(bachsHeaders({ 'bachs-signature': sig, 'bachs-timestamp': ts }), body, secret, now)).toBe(true);
    expect(bachsSignatureOk(bachsHeaders({ 'bachs-signature': 'v1=deadbeef', 'bachs-timestamp': ts }), body, secret, now)).toBe(false);
  });
});
