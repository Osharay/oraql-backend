import { ApiFootballAdapter, ApiFootballQuotaExhausted } from './api-football.adapter';

/**
 * The provider reports most failures in the response body, frequently with
 * HTTP 200. Before these checks a backfill fired 24 requests back to back,
 * tripped the per-minute limit, failed every one in the same second, and
 * logged "Backfill complete".
 */

type Reply = { status?: number; body: unknown; headers?: Record<string, string> };

function stubFetch(replies: Reply[]) {
  const calls: number[] = [];
  let i = 0;
  const fn = jest.fn(async () => {
    calls.push(Date.now());
    const r = replies[Math.min(i++, replies.length - 1)];
    return {
      status: r.status ?? 200,
      ok: (r.status ?? 200) < 400,
      headers: { get: (k: string) => r.headers?.[k.toLowerCase()] ?? null },
      text: async () => JSON.stringify(r.body),
    } as unknown as Response;
  });
  (global as unknown as { fetch: typeof fn }).fetch = fn;
  return { fn, calls };
}

function makeAdapter() {
  const config = { get: (k: string) => (k.endsWith('baseUrl') ? 'https://api.test' : 'key') };
  return new ApiFootballAdapter(config as never);
}

const ok = (response: unknown): Reply => ({ body: { errors: [], response } });

describe('ApiFootballAdapter request handling', () => {
  const env = { ...process.env };

  beforeEach(() => {
    process.env.API_FOOTBALL_MIN_INTERVAL_MS = '0';
    process.env.API_FOOTBALL_RETRY_BASE_MS = '1';
  });
  afterEach(() => {
    process.env = { ...env };
  });

  it('returns the payload on a clean response', async () => {
    stubFetch([ok([{ fixture: { id: 1 } }])]);
    const adapter = makeAdapter();
    const result = await (adapter as unknown as {
      request: (e: string) => Promise<unknown[]>;
    }).request('fixtures');
    expect(result).toHaveLength(1);
  });

  it('retries a 429 and succeeds', async () => {
    const { fn } = stubFetch([
      { status: 429, body: { errors: { rateLimit: 'Too many requests.' }, response: [] } },
      ok([{ id: 1 }]),
    ]);
    const adapter = makeAdapter();
    const result = await (adapter as never as { request: (e: string) => Promise<unknown[]> })
      .request('fixtures');
    expect(fn).toHaveBeenCalledTimes(2);
    expect(result).toHaveLength(1);
  });

  it('retries a rate limit reported with HTTP 200', async () => {
    const { fn } = stubFetch([
      { body: { errors: { rateLimit: 'Too many requests.' }, response: [] } },
      ok([{ id: 1 }]),
    ]);
    const adapter = makeAdapter();
    await (adapter as never as { request: (e: string) => Promise<unknown[]> }).request('fixtures');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('gives up after its retries rather than looping forever', async () => {
    const { fn } = stubFetch([
      { status: 429, body: { errors: { rateLimit: 'Too many requests.' }, response: [] } },
    ]);
    const adapter = makeAdapter();
    await expect(
      (adapter as never as { request: (e: string) => Promise<unknown[]> }).request('fixtures'),
    ).rejects.toThrow(/429/);
    expect(fn).toHaveBeenCalledTimes(5); // first try + 4 retries
  });

  it('stops at once when the daily allowance is spent', async () => {
    const { fn } = stubFetch([
      { body: { errors: { requests: 'You have reached the request limit for the day' }, response: [] } },
    ]);
    const adapter = makeAdapter();
    await expect(
      (adapter as never as { request: (e: string) => Promise<unknown[]> }).request('fixtures'),
    ).rejects.toBeInstanceOf(ApiFootballQuotaExhausted);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('treats any other body error as a failure, not as zero results', async () => {
    stubFetch([{ body: { errors: { token: 'Invalid key' }, response: [] } }]);
    const adapter = makeAdapter();
    await expect(
      (adapter as never as { request: (e: string) => Promise<unknown[]> }).request('fixtures'),
    ).rejects.toThrow(/failed/);
  });

  it('paces consecutive requests', async () => {
    process.env.API_FOOTBALL_MIN_INTERVAL_MS = '40';
    const { calls } = stubFetch([ok([]), ok([]), ok([])]);
    const adapter = makeAdapter();
    const req = (adapter as never as { request: (e: string) => Promise<unknown[]> }).request.bind(
      adapter,
    );
    await Promise.all([req('a'), req('b'), req('c')]);
    expect(calls).toHaveLength(3);
    expect(calls[1] - calls[0]).toBeGreaterThanOrEqual(35);
    expect(calls[2] - calls[1]).toBeGreaterThanOrEqual(35);
  });
});
