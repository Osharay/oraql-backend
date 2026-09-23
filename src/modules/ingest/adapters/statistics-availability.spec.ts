import { ApiFootballAdapter } from './api-football.adapter';

/**
 * The provider carries per-fixture statistics for the competitions it covers
 * deeply and none at all for the rest, on the same Pro account: a Champions
 * League tie returns shots, fouls and corners; a Copa Chile tie returns an
 * empty list. So giving up has to be per competition. A process-wide switch
 * would have turned statistics off for the majors after one sweep through
 * small leagues.
 */
describe('ApiFootballAdapter statistics availability', () => {
  beforeEach(() => ApiFootballAdapter.resetStatisticsState());
  afterAll(() => ApiFootballAdapter.resetStatisticsState());

  it('starts out willing to ask every league', () => {
    expect(ApiFootballAdapter.statisticsGivenUpFor('39')).toBe(false);
    expect(ApiFootballAdapter.statisticsState()).toEqual({
      leaguesTried: 0,
      leaguesWithStatistics: 0,
      leaguesGivenUp: 0,
    });
  });

  it('is reset cleanly', () => {
    ApiFootballAdapter.resetStatisticsState();
    expect(ApiFootballAdapter.statisticsState().leaguesTried).toBe(0);
  });
});
