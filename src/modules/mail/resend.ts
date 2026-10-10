/**
 * Resend's REST API, called directly (no SDK needed): one email, or a batch
 * of up to 100. Without RESEND_API_KEY nothing is sent and the call says so,
 * so local and test runs never email anyone.
 */
export interface OutgoingEmail {
  to: string;
  subject: string;
  html: string;
  text: string;
  headers?: Record<string, string>;
  tags?: Array<{ name: string; value: string }>;
}

export const resendConfigured = () => !!process.env.RESEND_API_KEY;
export const mailFrom = () => process.env.MAIL_FROM?.trim() || 'OraQL <hello@oraql.live>';
const replyTo = () => process.env.MAIL_REPLY_TO?.trim() || undefined;

const toResend = (e: OutgoingEmail) => ({
  from: mailFrom(),
  to: [e.to],
  subject: e.subject,
  html: e.html,
  text: e.text,
  ...(replyTo() ? { reply_to: replyTo() } : {}),
  ...(e.headers ? { headers: e.headers } : {}),
  ...(e.tags ? { tags: e.tags } : {}),
});

async function post(path: string, body: unknown): Promise<unknown> {
  const res = await fetch(`https://api.resend.com${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as { message?: string };
  if (!res.ok) throw new Error(`Resend ${res.status}: ${json.message ?? res.statusText}`);
  return json;
}

export async function resendOne(e: OutgoingEmail): Promise<void> {
  if (!resendConfigured()) throw new Error('RESEND_API_KEY is not set');
  await post('/emails', toResend(e));
}

/** Up to 100 emails in one request. */
export async function resendBatch(emails: OutgoingEmail[]): Promise<void> {
  if (!resendConfigured()) throw new Error('RESEND_API_KEY is not set');
  if (emails.length === 0) return;
  await post('/emails/batch', emails.map(toResend));
}
