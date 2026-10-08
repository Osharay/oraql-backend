/**
 * Flutterwave Standard: a hosted payment page for cards, bank transfer and USSD.
 * We create the link, the customer pays on Flutterwave, and we verify the
 * transaction by our reference from the server before giving access — the
 * redirect alone is never trusted.
 */
const BASE = 'https://api.flutterwave.com/v3';

export const flutterwaveConfigured = () => !!process.env.FLUTTERWAVE_SECRET_KEY;

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${process.env.FLUTTERWAVE_SECRET_KEY}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  const body = (await res.json().catch(() => ({}))) as { status?: string; message?: string };
  if (!res.ok || body.status !== 'success') {
    throw new Error(`Flutterwave: ${body.message ?? res.statusText}`);
  }
  return body as T;
}

export async function flutterwaveCheckout(input: {
  reference: string;
  amount: number;
  currency: string;
  email: string;
  name?: string | null;
  redirectUrl: string;
  description: string;
}): Promise<string> {
  const body = await call<{ data: { link: string } }>('/payments', {
    method: 'POST',
    body: JSON.stringify({
      tx_ref: input.reference,
      amount: input.amount,
      currency: input.currency,
      redirect_url: input.redirectUrl,
      customer: { email: input.email, ...(input.name ? { name: input.name } : {}) },
      customizations: { title: 'OraQL', description: input.description },
      meta: { reference: input.reference },
    }),
  });
  return body.data.link;
}

export interface FlutterwaveTransaction {
  id: number;
  tx_ref: string;
  status: string;
  amount: number;
  currency: string;
}

export async function flutterwaveVerify(reference: string): Promise<FlutterwaveTransaction | null> {
  try {
    const body = await call<{ data: FlutterwaveTransaction }>(
      `/transactions/verify_by_reference?tx_ref=${encodeURIComponent(reference)}`,
    );
    return body.data;
  } catch {
    return null;
  }
}
