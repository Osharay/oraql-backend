import { ApiFootballAdapter } from './api-football.adapter';

/**
 * A plan without /fixtures/statistics answers every request with an empty
 * list. Ten requests per team, forty teams a sweep, for nothing — this is the
 * guard that stops it, so it is worth a test of its own.
 */
describe('ApiFootballAdapter statistics availability', () => {
  beforeEach(() => ApiFootballAdapter.resetStatisticsState());
  afterAll(() => ApiFootballAdapter.resetStatisticsState());

  it('starts out willing to ask', () => {
    expect(ApiFootballAdapter.statisticsState().unavailable).toBe(false);
  });

  it('is reset cleanly', () => {
    ApiFootballAdapter.resetStatisticsState();
    expect(ApiFootballAdapter.statisticsState()).toEqual({ unavailable: false, emptyRun: 0 });
  });
});
