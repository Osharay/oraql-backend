jest.mock('./providers/flutterwave', () => ({
  flutterwaveConfigured: () => true,
  flutterwaveCheckout: jest.fn(async () => 'https://checkout.flutterwave.com/pay/abc'),
  flutterwaveVerify: jest.fn(),
}));
jest.mock('./providers/bachs', () => ({
  bachsConfigured: () => true,
  bachsCheckout: jest.fn(async () => ({ url: 'https://pay.bachs.io/chk_1', checkoutId: 'chk_1' })),
  bachsSession: jest.fn(),
  bachsPaid: (s: { status?: string; payment_status?: string }) => s.payment_status === 'paid',
}));

import { BillingService } from './billing.service';
import { flutterwaveVerify } from './providers/flutterwave';

const day = 86_400_000;

/** Just enough of Prisma for the payment path, in memory. */
function fakePrisma() {
  const users = new Map<string, any>([
    ['u1', { id: 'u1', email: 'a@b.c', firstName: 'Ada', lastName: null, role: 'USER', createdAt: new Date(Date.now() - 10 * day), trialEndsAt: new Date(Date.now() - day), subscriptionEndsAt: null }],
  ]);
  const payments = new Map<string, any>();
  const prisma: any = {
    billingSettings: { findUnique: async () => null, upsert: async () => null },
    user: {
      findUnique: async ({ where }: any) => users.get(where.id) ?? null,
      findUniqueOrThrow: async ({ where }: any) => users.get(where.id),
      update: async ({ where, data }: any) => Object.assign(users.get(where.id), data),
    },
    payment: {
      create: async ({ data }: any) => {
        const p = { id: `p${payments.size + 1}`, status: 'PENDING', providerRef: null, ...data };
        payments.set(p.id, p);
        return p;
      },
      update: async ({ where, data }: any) => Object.assign(payments.get(where.id), data),
      findUnique: async ({ where }: any) => [...payments.values()].find((p) => p.reference === where.reference) ?? null,
      findUniqueOrThrow: async ({ where }: any) => payments.get(where.id),
      findFirst: async ({ where }: any) =>
        [...payments.values()]
          .filter((p) => Object.entries(where).every(([k, v]) => p[k] === v))
          .sort((a, b) => (b.paidAt?.getTime() ?? 0) - (a.paidAt?.getTime() ?? 0))[0] ?? null,
      updateMany: async ({ where, data }: any) => {
        const p = payments.get(where.id);
        if (!p || p.status === 'PAID') return { count: 0 };
        Object.assign(p, data);
        return { count: 1 };
      },
    },
    $transaction: async (fn: any) => fn(prisma),
  };
  return { prisma, users, payments };
}

describe('BillingService', () => {
  beforeEach(() => (flutterwaveVerify as jest.Mock).mockReset());

  it('locks an expired trial, and a paid month opens it for 30 days', async () => {
    const { prisma, users } = fakePrisma();
    const svc = new BillingService(prisma);
    expect(await svc.allowed('u1')).toBe(false);

    const { reference } = await svc.checkout('u1', 'MONTHLY', 'FLUTTERWAVE');
    (flutterwaveVerify as jest.Mock).mockResolvedValue({ id: 99, tx_ref: reference, status: 'successful', amount: 5000, currency: 'NGN' });
    const res = await svc.confirm(reference, 'u1');

    expect(res.paid).toBe(true);
    const ends = users.get('u1').subscriptionEndsAt.getTime();
    expect(Math.abs(ends - (Date.now() + 30 * day))).toBeLessThan(5000);
    expect(await svc.allowed('u1')).toBe(true);
  });

  it('applies a payment once when the webhook and the return page both arrive', async () => {
    const { prisma, users } = fakePrisma();
    const svc = new BillingService(prisma);
    const { reference } = await svc.checkout('u1', 'QUARTERLY', 'FLUTTERWAVE');
    (flutterwaveVerify as jest.Mock).mockResolvedValue({ id: 7, tx_ref: reference, status: 'successful', amount: 10000, currency: 'NGN' });

    await Promise.all([svc.confirm(reference, 'u1'), svc.onFlutterwaveEvent({ event: 'charge.completed', data: { tx_ref: reference } })]);
    await svc.confirm(reference, 'u1');

    const ends = users.get('u1').subscriptionEndsAt.getTime();
    expect(Math.abs(ends - (Date.now() + 90 * day))).toBeLessThan(5000); // 90 days, not 180
  });

  it('gives nothing for an underpaid, failed or someone else\'s payment', async () => {
    const { prisma, users } = fakePrisma();
    const svc = new BillingService(prisma);
    const { reference } = await svc.checkout('u1', 'MONTHLY', 'FLUTTERWAVE');

    (flutterwaveVerify as jest.Mock).mockResolvedValue({ id: 1, tx_ref: reference, status: 'successful', amount: 500, currency: 'NGN' });
    expect((await svc.confirm(reference, 'u1')).paid).toBe(false);
    (flutterwaveVerify as jest.Mock).mockResolvedValue({ id: 1, tx_ref: reference, status: 'failed', amount: 5000, currency: 'NGN' });
    expect((await svc.confirm(reference, 'u1')).paid).toBe(false);
    await expect(svc.confirm(reference, 'someone-else')).rejects.toThrow('Payment not found');
    expect(users.get('u1').subscriptionEndsAt).toBeNull();
  });

  it('applies a signed Bachs checkout.completed once, and refuses a wrong amount', async () => {
    const { prisma, users } = fakePrisma();
    const svc = new BillingService(prisma);
    const { reference } = await svc.checkout('u1', 'MONTHLY', 'BACHS');

    expect(await svc.onBachsEvent({ type: 'checkout.completed', data: { reference, payment_status: 'paid', amount: '100.00', currency: 'NGN' } })).toEqual({ ignored: true });
    expect(users.get('u1').subscriptionEndsAt).toBeNull();

    const event = { type: 'checkout.completed', data: { reference, checkout_id: 'chk_1', payment_status: 'paid', amount: '5000.00', currency: 'NGN' } };
    await svc.onBachsEvent(event);
    await svc.onBachsEvent(event); // delivered again
    const ends = users.get('u1').subscriptionEndsAt.getTime();
    expect(Math.abs(ends - (Date.now() + 30 * day))).toBeLessThan(5000);
  });

  it('adds a renewal in the last days to the days still left', async () => {
    const { prisma, users } = fakePrisma();
    users.get('u1').subscriptionEndsAt = new Date(Date.now() + 2 * day);
    const svc = new BillingService(prisma);
    const { reference } = await svc.checkout('u1', 'MONTHLY', 'FLUTTERWAVE');
    (flutterwaveVerify as jest.Mock).mockResolvedValue({ id: 2, tx_ref: reference, status: 'successful', amount: 5000, currency: 'NGN' });
    await svc.confirm(reference, 'u1');
    const ends = users.get('u1').subscriptionEndsAt.getTime();
    expect(Math.abs(ends - (Date.now() + 32 * day))).toBeLessThan(5000);
  });

  it('while a month runs: no second month, but an upgrade to 3 months adds 90 days on top', async () => {
    const { prisma, users } = fakePrisma();
    const svc = new BillingService(prisma);
    const first = await svc.checkout('u1', 'MONTHLY', 'FLUTTERWAVE');
    (flutterwaveVerify as jest.Mock).mockResolvedValue({ id: 3, tx_ref: first.reference, status: 'successful', amount: 5000, currency: 'NGN' });
    await svc.confirm(first.reference, 'u1');

    await expect(svc.checkout('u1', 'MONTHLY', 'FLUTTERWAVE')).rejects.toThrow('already on the monthly plan');
    const status = await svc.status('u1');
    expect(status.plans.map((p) => [p.id, p.buyable])).toEqual([['MONTHLY', false], ['QUARTERLY', true]]);

    const up = await svc.checkout('u1', 'QUARTERLY', 'FLUTTERWAVE');
    (flutterwaveVerify as jest.Mock).mockResolvedValue({ id: 4, tx_ref: up.reference, status: 'successful', amount: 10000, currency: 'NGN' });
    await svc.confirm(up.reference, 'u1');
    const ends = users.get('u1').subscriptionEndsAt.getTime();
    expect(Math.abs(ends - (Date.now() + 120 * day))).toBeLessThan(5000);

    // On 3 months now: nothing more to buy until the last days.
    await expect(svc.checkout('u1', 'QUARTERLY', 'FLUTTERWAVE')).rejects.toThrow('already have an active subscription');
    expect((await svc.status('u1')).plans.every((p) => !p.buyable)).toBe(true);
  });
});
