import { formatBody, messageEmail, receiptEmail, resetEmail, welcomeEmail } from './templates';
import { hashToken, newToken, unsubscribeOk, unsubscribeSig } from './mail-tokens';

const site = 'https://www.oraql.live';

describe('email templates', () => {
  it('escape what an admin types, and format bold, links and paragraphs', () => {
    const html = formatBody('Hello <script>x</script>\n\n**Big** news: [see it](https://www.oraql.live/results)');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('<strong');
    expect(html).toContain('href="https://www.oraql.live/results"');
    expect(html.match(/<p /g)).toHaveLength(2);
  });

  it('a link that is not http(s) stays text', () => {
    expect(formatBody('[x](javascript:alert(1))')).not.toContain('href="javascript');
  });

  it('newsletters carry an unsubscribe link; one-off messages do not', () => {
    const news = messageEmail({ subject: 'Week 1', body: 'Hi', name: 'Ada', unsubscribeUrl: `${site}/unsubscribe?u=1&s=x`, siteUrl: site });
    expect(news.html).toContain('Unsubscribe');
    expect(news.text).toContain('Unsubscribe');
    const one = messageEmail({ subject: 'About your account', body: 'Hi', name: 'Ada', siteUrl: site });
    expect(one.html).not.toContain('Unsubscribe');
  });

  it('account emails link to the right pages and greet by name', () => {
    const w = welcomeEmail({ name: 'Ada', verifyUrl: `${site}/auth/verify?token=abc`, trialDays: 2, siteUrl: site });
    expect(w.html).toContain('Hi Ada,');
    expect(w.html).toContain('/auth/verify?token=abc');
    expect(w.text).toContain('2 days of full access');
    const r = resetEmail({ name: null, resetUrl: `${site}/auth/reset?token=t`, siteUrl: site });
    expect(r.html).toContain('Hi there,');
    expect(r.html).toContain('1 hour');
  });

  it('a receipt lists the plan, amount and end date', () => {
    const e = receiptEmail({ name: 'Ada', plan: '3 months', amount: '₦15,000', provider: 'Bachs', reference: 'oraql_1', until: 'Sun, 8 Nov 2026', siteUrl: site });
    for (const v of ['3 months', '₦15,000', 'Bachs', 'oraql_1', 'Sun, 8 Nov 2026']) expect(e.html).toContain(v);
  });
});

describe('mail tokens', () => {
  it('stores only a hash, and unsubscribe links cannot be forged', () => {
    const { token, hash } = newToken();
    expect(hash).toBe(hashToken(token));
    expect(hash).not.toContain(token);
    expect(unsubscribeOk('user-1', unsubscribeSig('user-1'))).toBe(true);
    expect(unsubscribeOk('user-2', unsubscribeSig('user-1'))).toBe(false);
    expect(unsubscribeOk('user-1', undefined)).toBe(false);
  });
});
