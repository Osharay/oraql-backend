import { clusterOutcome, driverOf, hitRate, hitRateBy } from './results-summary';

describe('results summary', () => {
  it('counts wins against what was expected, leaving out voids and unknowns', () => {
    const r = hitRate([
      { result: 'WIN', probability: 0.8 },
      { result: 'LOSS', probability: 0.6 },
      { result: 'VOID', probability: 0.9 },
      { result: 'UNKNOWN', probability: 0.9 },
    ]);
    expect(r).toEqual({ settled: 2, won: 1, rate: 0.5, expected: 0.7 });
    expect(hitRate([])).toEqual({ settled: 0, won: 0, rate: null, expected: null });
  });

  it('splits by any key', () => {
    const r = hitRateBy(
      [
        { result: 'WIN', probability: 0.5, s: 'club' },
        { result: 'LOSS', probability: 0.5, s: 'international' },
      ],
      (i) => i.s,
    );
    expect(Object.keys(r)).toEqual(['club', 'international']);
    expect(r.club.won).toBe(1);
  });

  it('tells recent-led picks from season-led ones', () => {
    expect(driverOf({ emerging: true }, 0.5)).toBe('RECENT');
    expect(driverOf({ formRate: 0.7 }, 0.6)).toBe('RECENT');
    expect(driverOf({ formRate: 0.6 }, 0.6)).toBe('SEASON');
    expect(driverOf(null, 0.6)).toBe('SEASON');
  });

  it('settles a cluster only when all of it has', () => {
    expect(clusterOutcome(['WIN', 'WIN'])).toBe('WIN');
    expect(clusterOutcome(['WIN', 'LOSS', null])).toBe('LOSS');
    expect(clusterOutcome(['WIN', null])).toBe('PENDING');
    expect(clusterOutcome(['WIN', 'VOID'])).toBe('WIN');
  });
});

describe('firstOfEach', () => {
  it('keeps the first of each key in order', () => {
    const { firstOfEach } = jest.requireActual('./results-summary');
    expect(firstOfEach([{ k: 'a', n: 1 }, { k: 'b', n: 2 }, { k: 'a', n: 3 }], (i: { k: string }) => i.k)).toEqual([
      { k: 'a', n: 1 },
      { k: 'b', n: 2 },
    ]);
  });
});

describe('publishedBeforeKickoff', () => {
  const { publishedBeforeKickoff } = jest.requireActual('./results-summary');
  const ko = new Date('2026-10-05T15:00:00Z');
  it('counts a call made before kickoff', () => {
    expect(publishedBeforeKickoff(new Date('2026-10-05T14:00:00Z'), ko)).toBe(true);
  });
  it('does not count one made at or after kickoff', () => {
    expect(publishedBeforeKickoff(ko, ko)).toBe(false);
    expect(publishedBeforeKickoff(new Date('2026-10-05T15:30:00Z'), ko)).toBe(false);
  });
  it('does not count one with no time on it', () => {
    expect(publishedBeforeKickoff(null, ko)).toBe(false);
  });
});
