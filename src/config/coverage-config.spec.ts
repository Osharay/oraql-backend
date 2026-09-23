import { trackedLeagueIds, coverageBudget, coverageSeasons } from './app.config';

/**
 * Coverage used to be a hand-kept list of six competitions, which meant a
 * fixture from anywhere else sat in the database with no history behind it
 * and could never produce a streak. These defaults are what make breadth the
 * normal case, so they are pinned.
 */
describe('coverage configuration', () => {
  const env = process.env;
  beforeEach(() => {
    process.env = { ...env };
    delete process.env.TRACKED_LEAGUE_IDS;
    delete process.env.COVERAGE_MAX_REQUESTS;
    delete process.env.COVERAGE_SEASONS;
  });
  afterAll(() => {
    process.env = env;
  });

  it('tracks every competition by default', () => {
    expect(trackedLeagueIds()).toEqual([]);
  });

  it('still narrows when a deployment asks for it', () => {
    process.env.TRACKED_LEAGUE_IDS = '39, 140 ,78';
    expect(trackedLeagueIds()).toEqual(['39', '140', '78']);
  });

  it('spends a bounded share of the quota on widening per run', () => {
    expect(coverageBudget()).toBe(100);
    process.env.COVERAGE_MAX_REQUESTS = '250';
    expect(coverageBudget()).toBe(250);
  });

  it('refuses a budget that would swallow any quota', () => {
    process.env.COVERAGE_MAX_REQUESTS = '999999';
    expect(coverageBudget()).toBe(1000);
  });

  it('ignores nonsense and falls back to the default', () => {
    process.env.COVERAGE_MAX_REQUESTS = 'lots';
    expect(coverageBudget()).toBe(100);
    process.env.COVERAGE_SEASONS = '-2';
    expect(coverageSeasons()).toBe(3);
  });

  it('fetches three seasons of history by default, six at most', () => {
    expect(coverageSeasons()).toBe(3);
    process.env.COVERAGE_SEASONS = '10';
    expect(coverageSeasons()).toBe(6);
  });
});
