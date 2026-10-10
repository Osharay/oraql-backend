/**
 * OraQL's emails, in the OraQL_ design system: warm cream page, a dark ink
 * header with the gold wordmark, a warm white card, a dark ink button. Built
 * with tables and inline styles so Gmail, Outlook and phone mail apps all show
 * it the same way. Every email also has a plain-text version.
 */

export const C = {
  page: '#F0ECE4', // warm cream
  card: '#FAF8F5', // warm white
  border: '#E5DFD3', // warm sand
  ink: '#1A1A1E', // dark ink
  gold: '#C8A44E',
  goldDark: '#A88A3A',
  text: '#1A1A1E',
  text2: '#5A5A64',
  text3: '#8A8A94',
  good: '#1FA85C',
};

const DISPLAY = "'Space Grotesk', 'Segoe UI', Helvetica, Arial, sans-serif";
const BODY = "Inter, 'Segoe UI', Helvetica, Arial, sans-serif";

export interface Email {
  subject: string;
  html: string;
  text: string;
}

export const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export function button(label: string, url: string) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:28px 0 8px"><tr><td style="background:${C.ink};border-radius:8px">
<a href="${esc(url)}" target="_blank" style="display:inline-block;padding:14px 26px;font-family:${DISPLAY};font-size:15px;font-weight:600;color:#FAF8F5;text-decoration:none;border-radius:8px">${esc(label)}&nbsp;&rarr;</a>
</td></tr></table>`;
}

export const p = (html: string) =>
  `<p style="margin:0 0 16px;font-family:${BODY};font-size:15px;line-height:1.6;color:${C.text2}">${html}</p>`;

export const small = (html: string) =>
  `<p style="margin:16px 0 0;font-family:${BODY};font-size:13px;line-height:1.5;color:${C.text3}">${html}</p>`;

/** A two-column summary box, e.g. a receipt. */
export function facts(rows: Array<[string, string]>) {
  const tr = rows
    .map(
      ([k, v], i) =>
        `<tr><td style="padding:10px 16px;font-family:${BODY};font-size:14px;color:${C.text2};${i ? `border-top:1px solid ${C.border};` : ''}">${esc(k)}</td>` +
        `<td align="right" style="padding:10px 16px;font-family:${BODY};font-size:14px;font-weight:600;color:${C.text};${i ? `border-top:1px solid ${C.border};` : ''}">${esc(v)}</td></tr>`,
    )
    .join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 8px;border:1px solid ${C.border};border-radius:10px;background:#FFFFFF;border-collapse:separate">${tr}</table>`;
}

/**
 * The frame every email shares. `eyebrow` is the small gold label above the
 * title; `footer` carries the unsubscribe line on newsletters.
 */
export function layout(o: { preheader: string; eyebrow?: string; title: string; body: string; footer?: string; siteUrl: string }) {
  const site = o.siteUrl.replace(/\/$/, '');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light">
<title>${esc(o.title)}</title></head>
<body style="margin:0;padding:0;background:${C.page};-webkit-text-size-adjust:100%">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${esc(o.preheader)}&#8203;&nbsp;&#8203;&nbsp;&#8203;&nbsp;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.page}"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px">
<tr><td style="background:${C.ink};border-radius:14px 14px 0 0;padding:22px 32px">
<a href="${esc(site)}" style="text-decoration:none;font-family:${DISPLAY};font-size:22px;font-weight:700;letter-spacing:-0.5px;color:#FAF8F5">OraQL<span style="color:${C.gold}">_</span></a>
</td></tr>
<tr><td style="height:3px;background:${C.gold};line-height:3px;font-size:0">&nbsp;</td></tr>
<tr><td style="background:${C.card};border:1px solid ${C.border};border-top:0;border-radius:0 0 14px 14px;padding:36px 32px 32px">
${o.eyebrow ? `<p style="margin:0 0 8px;font-family:${BODY};font-size:12px;font-weight:700;letter-spacing:1.6px;text-transform:uppercase;color:${C.goldDark}">${esc(o.eyebrow)}</p>` : ''}
<h1 style="margin:0 0 20px;font-family:${DISPLAY};font-size:26px;line-height:1.25;font-weight:700;letter-spacing:-0.4px;color:${C.text}">${esc(o.title)}</h1>
${o.body}
</td></tr>
<tr><td style="padding:24px 8px 0;text-align:center;font-family:${BODY};font-size:12px;line-height:1.6;color:${C.text3}">
OraQL_ — sports betting research. OraQL is a research tool, not a promise of winnings. 18+. Bet only what you can afford to lose.<br>
<a href="${esc(site)}" style="color:${C.text3}">${esc(site.replace(/^https?:\/\//, ''))}</a>${o.footer ? `<br>${o.footer}` : ''}
</td></tr>
</table></td></tr></table></body></html>`;
}

const hello = (name?: string | null) => (name ? `Hi ${esc(name)},` : 'Hi there,');
const helloText = (name?: string | null) => (name ? `Hi ${name},` : 'Hi there,');
const signoff = 'The OraQL team';

export function welcomeEmail(o: { name?: string | null; verifyUrl: string; trialDays: number; siteUrl: string }): Email {
  const trial = o.trialDays > 0 ? `You have ${o.trialDays} day${o.trialDays === 1 ? '' : 's'} of full access, free.` : '';
  return {
    subject: 'Welcome to OraQL — confirm your email',
    html: layout({
      siteUrl: o.siteUrl,
      preheader: 'Confirm your email to finish setting up your account.',
      eyebrow: 'Welcome',
      title: 'Your OraQL account is ready',
      body:
        p(hello(o.name)) +
        p(`Thanks for joining OraQL. ${trial} Streaks, clusters, picks and the full results record are all open to you.`) +
        p('Please confirm this is your email address, so we can reach you about your account and payments.') +
        button('Confirm my email', o.verifyUrl) +
        small('The link works for 3 days. If you did not create an OraQL account, you can ignore this email.'),
    }),
    text: `${helloText(o.name)}\n\nThanks for joining OraQL. ${trial}\n\nConfirm your email: ${o.verifyUrl}\n\nThe link works for 3 days. If you did not create an OraQL account, ignore this email.\n\n${signoff}`,
  };
}

export function verifyEmail(o: { name?: string | null; verifyUrl: string; siteUrl: string }): Email {
  return {
    subject: 'Confirm your email for OraQL',
    html: layout({
      siteUrl: o.siteUrl,
      preheader: 'One click to confirm your email address.',
      eyebrow: 'Your account',
      title: 'Confirm your email',
      body:
        p(hello(o.name)) +
        p('Click below to confirm this is your email address for OraQL.') +
        button('Confirm my email', o.verifyUrl) +
        small('The link works for 3 days. If you did not ask for this, you can ignore it.'),
    }),
    text: `${helloText(o.name)}\n\nConfirm your email for OraQL: ${o.verifyUrl}\n\nThe link works for 3 days.\n\n${signoff}`,
  };
}

export function resetEmail(o: { name?: string | null; resetUrl: string; siteUrl: string }): Email {
  return {
    subject: 'Reset your OraQL password',
    html: layout({
      siteUrl: o.siteUrl,
      preheader: 'Set a new password — the link works for 1 hour.',
      eyebrow: 'Your account',
      title: 'Reset your password',
      body:
        p(hello(o.name)) +
        p('Someone asked to reset the password for your OraQL account. If it was you, choose a new password below.') +
        button('Set a new password', o.resetUrl) +
        small('The link works once, for 1 hour. If you did not ask for this, ignore this email — your password stays as it is.'),
    }),
    text: `${helloText(o.name)}\n\nSet a new OraQL password: ${o.resetUrl}\n\nThe link works once, for 1 hour. If you did not ask for this, ignore this email.\n\n${signoff}`,
  };
}

export function passwordChangedEmail(o: { name?: string | null; siteUrl: string; when: string }): Email {
  const forgot = `${o.siteUrl.replace(/\/$/, '')}/auth/forgot`;
  return {
    subject: 'Your OraQL password was changed',
    html: layout({
      siteUrl: o.siteUrl,
      preheader: 'Your password was just changed.',
      eyebrow: 'Security',
      title: 'Your password was changed',
      body:
        p(hello(o.name)) +
        p(`The password for your OraQL account was changed on ${esc(o.when)}, and every device was signed out.`) +
        p(`If this was you, there is nothing to do. If it was not, <a href="${esc(forgot)}" style="color:${C.goldDark};font-weight:600">reset your password</a> straight away and reply to this email.`),
    }),
    text: `${helloText(o.name)}\n\nYour OraQL password was changed on ${o.when}, and every device was signed out.\nIf this was not you, reset it now: ${forgot}\n\n${signoff}`,
  };
}

export function receiptEmail(o: {
  name?: string | null;
  plan: string;
  amount: string;
  provider: string;
  reference: string;
  until: string;
  siteUrl: string;
}): Email {
  const dash = `${o.siteUrl.replace(/\/$/, '')}/dashboard`;
  return {
    subject: `Payment received — OraQL ${o.plan}`,
    html: layout({
      siteUrl: o.siteUrl,
      preheader: `Thanks — full access until ${o.until}.`,
      eyebrow: 'Receipt',
      title: 'Payment received',
      body:
        p(hello(o.name)) +
        p('Thank you for subscribing. Your payment went through and your access is on.') +
        facts([
          ['Plan', o.plan],
          ['Amount paid', o.amount],
          ['Paid with', o.provider],
          ['Full access until', o.until],
          ['Reference', o.reference],
        ]) +
        button('Open OraQL', dash) +
        small('This was a one-off payment: nothing renews by itself. Keep this email as your receipt.'),
    }),
    text: `${helloText(o.name)}\n\nPayment received — thank you.\nPlan: ${o.plan}\nAmount paid: ${o.amount}\nPaid with: ${o.provider}\nFull access until: ${o.until}\nReference: ${o.reference}\n\nThis was a one-off payment: nothing renews by itself.\n\n${signoff}`,
  };
}

export function endingEmail(o: { name?: string | null; kind: 'trial' | 'subscription'; until: string; siteUrl: string }): Email {
  const sub = `${o.siteUrl.replace(/\/$/, '')}/subscribe`;
  const trial = o.kind === 'trial';
  return {
    subject: trial ? 'Your OraQL free trial ends tomorrow' : 'Your OraQL subscription ends tomorrow',
    html: layout({
      siteUrl: o.siteUrl,
      preheader: `Your access ends ${o.until}. Keep it going in a minute.`,
      eyebrow: trial ? 'Free trial' : 'Subscription',
      title: trial ? 'Your free trial ends tomorrow' : 'Your subscription ends tomorrow',
      body:
        p(hello(o.name)) +
        p(
          `Your ${trial ? 'free trial' : 'OraQL access'} ends on <strong style="color:${C.text}">${esc(o.until)}</strong>. After that, streaks, clusters, picks and the results record are locked until you subscribe.`,
        ) +
        p('Plans start from a single day, and nothing renews by itself — you only pay when you choose to.') +
        button(trial ? 'Choose a plan' : 'Renew my access', sub),
    }),
    text: `${helloText(o.name)}\n\nYour ${trial ? 'free trial' : 'OraQL access'} ends on ${o.until}. After that the app is locked until you subscribe.\nChoose a plan: ${sub}\n\nNothing renews by itself.\n\n${signoff}`,
  };
}

/**
 * Turn the plain text written in Engine controls into email HTML: a blank line
 * starts a new paragraph, **bold**, and [text](https://link). Everything is
 * escaped first, so nothing typed can inject markup.
 */
export function formatBody(body: string) {
  const inline = (s: string) =>
    esc(s)
      .replace(/\*\*(.+?)\*\*/g, `<strong style="color:${C.text}">$1</strong>`)
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, `<a href="$2" style="color:${C.goldDark};font-weight:600">$1</a>`)
      .replace(/\n/g, '<br>');
  return body
    .trim()
    .split(/\n\s*\n/)
    .filter(Boolean)
    .map((para) => p(inline(para)))
    .join('');
}

export const plainBody = (body: string) =>
  body.trim().replace(/\*\*(.+?)\*\*/g, '$1').replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '$1 ($2)');

export function messageEmail(o: {
  subject: string;
  body: string;
  name?: string | null;
  buttonText?: string | null;
  buttonUrl?: string | null;
  unsubscribeUrl?: string | null;
  siteUrl: string;
}): Email {
  const greet = o.name !== undefined;
  const btn = o.buttonText && o.buttonUrl ? button(o.buttonText, o.buttonUrl) : '';
  const unsub = o.unsubscribeUrl
    ? `You are getting this because you have an OraQL account. <a href="${esc(o.unsubscribeUrl)}" style="color:${C.text3}">Unsubscribe from newsletters</a>.`
    : undefined;
  return {
    subject: o.subject,
    html: layout({
      siteUrl: o.siteUrl,
      preheader: plainBody(o.body).split('\n')[0].slice(0, 120),
      title: o.subject,
      body: (greet ? p(hello(o.name)) : '') + formatBody(o.body) + btn,
      footer: unsub,
    }),
    text:
      `${greet ? `${helloText(o.name)}\n\n` : ''}${plainBody(o.body)}` +
      (o.buttonText && o.buttonUrl ? `\n\n${o.buttonText}: ${o.buttonUrl}` : '') +
      (o.unsubscribeUrl ? `\n\nUnsubscribe from newsletters: ${o.unsubscribeUrl}` : '') +
      `\n\n${signoff}`,
  };
}
