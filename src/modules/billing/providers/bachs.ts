/**
 * Bachs: a hosted checkout for cards, transfer and stablecoins (USDT, USDC).
 * A checkout session carries our reference; the signed `checkout.completed`
 * webhook, or reading the session back from the server, confirms payment.
 * Sandbox keys (sk_sandbox_…) use the sandbox API, live keys the live one.
 */
export const bachsConfigured = () => !!process.env.BACHS_API_KEY;

function baseUrl(): string {
  const explicit = process.env.BACHS_API_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, '');
  return (process.env.BACHS_API_KEY ?? '').startsWith('sk_live_')
    ? 'https://api.bachs.io'
    : 'https://sandbox-api.bachs.io';
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${baseUrl()}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${process.env.BACHS_API_KEY}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const message = (body.message ?? (body.error as { message?: string } | undefined)?.message ?? res.statusText) as string;
    throw new Error(`Bachs: ${message}`);
  }
  return body as T;
}

export async function bachsCheckout(input: {
  reference: string;
  amount: number;
  currency: string;
  email: string;
  name?: string | null;
  successUrl: string;
  cancelUrl: string;
  plan: string;
}): Promise<{ url: string; checkoutId: string }> {
  const body = await call<{ checkout_id: string; checkout_url: string }>('/v1/checkout-sessions', {
    method: 'POST',
    body: JSON.stringify({
      pricing: { currency: input.currency, amount: input.amount.toFixed(2) },
      customer: { email: input.email, ...(input.name ? { name: input.name } : {}) },
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      reference: input.reference,
      metadata: { reference: input.reference, plan: input.plan },
      expires_in_minutes: 60,
    }),
  });
  return { url: body.checkout_url, checkoutId: body.checkout_id };
}

export interface BachsSession {
  checkout_id: string;
  status?: string;
  payment_status?: string;
  amount?: string;
  currency?: string;
  reference?: string;
}

export async function bachsSession(checkoutId: string): Promise<BachsSession | null> {
  try {
    return await call<BachsSession>(`/v1/checkout-sessions/${encodeURIComponent(checkoutId)}`);
  } catch {
    return null;
  }
}

/** Paid, as a session or a checkout.completed event reports it. */
export const bachsPaid = (s: { status?: string; payment_status?: string }) =>
  s.payment_status === 'paid' || (s.status === 'completed' && s.payment_status == null);
