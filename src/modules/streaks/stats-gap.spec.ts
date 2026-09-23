import { MARKET_DEFINITIONS } from './market-definitions';

/**
 * Corner and card markets need per-match statistics. This account's provider
 * returns none, so every finished match was writing an UNKNOWN per such
 * market and side — about one row in ten, on every match, recording a gap
 * that can never fill.
 *
 * Those rows are no longer written, which only works because the completeness
 * check expects fewer rows for a match with no statistics. These pin the two
 * counts that decision rests on.
 */
const needsStats = (requires: readonly string[]) =>
  requires.some((r) => r === 'corners' || r === 'cards');

describe('markets that depend on per-match statistics', () => {
  const statsMarkets = MARKET_DEFINITIONS.filter((d) => needsStats(d.requires));

  it('exist, and are only corner and card markets', () => {
    expect(statsMarkets.length).toBeGreaterThan(0);
    for (const m of statsMarkets) {
      expect(m.marketId).toMatch(/CORNER|CARD/i);
    }
  });

  // Measured, not guessed: 5 rows of 103 per match, about 4.9%. I had told
  // the client "10 to 15%" from memory; this is what it actually is.
  it('are about a twentieth of every row written for a match', () => {
    const all = MARKET_DEFINITIONS.reduce((n, d) => n + d.selections.length, 0);
    const withoutStats = MARKET_DEFINITIONS.filter((d) => !needsStats(d.requires)).reduce(
      (n, d) => n + d.selections.length,
      0,
    );
    const saved = all - withoutStats;

    expect(saved).toBe(5);
    expect(all).toBe(103);
    expect(saved / all).toBeCloseTo(0.049, 3);
  });

  it('leaves goals, result and half-time markets untouched', () => {
    const untouched = MARKET_DEFINITIONS.filter((d) => !needsStats(d.requires));
    expect(untouched.some((d) => d.requires.includes('halftime'))).toBe(true);
    expect(untouched.some((d) => d.requires.includes('goals'))).toBe(true);
  });

  it('never needs statistics for a market that reads only the score', () => {
    for (const d of MARKET_DEFINITIONS) {
      if (d.requires.every((r) => r === 'goals' || r === 'halftime')) {
        expect(needsStats(d.requires)).toBe(false);
      }
    }
  });
});
