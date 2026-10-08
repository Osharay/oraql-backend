import {
  pickDiverseComponents,
  combinedProbability,
  MIN_CLUSTER_SIZE,
  type Selectable,
} from './cluster-selection';

const item = (
  id: string,
  eventId: string,
  marketDefinitionId: string,
  strengthScore: number,
  leagueId = 'L1',
  hitRate = 0.85,
): Selectable => ({ id, eventId, marketDefinitionId, strengthScore, leagueId, hitRate });

describe('pickDiverseComponents', () => {
  it('takes the strongest first', () => {
    const picked = pickDiverseComponents(
      [
        item('a', 'e1', 'm1', 0.4),
        item('b', 'e2', 'm2', 0.9),
        item('c', 'e3', 'm3', 0.6),
      ],
      { size: 3 },
    );
    expect(picked.map((p) => p.id)).toEqual(['b', 'c', 'a']);
  });

  /** Two selections from one match are not independent in any useful sense. */
  it('never takes two components from the same event', () => {
    const picked = pickDiverseComponents(
      [
        item('a', 'e1', 'm1', 0.9),
        item('b', 'e1', 'm2', 0.8),
        item('c', 'e2', 'm3', 0.7),
      ],
      { size: 3 },
    );
    expect(picked.map((p) => p.id)).toEqual(['a', 'c']);
  });

  /** Four variations of one market is one idea repeated, not a cluster. */
  it('never repeats a market', () => {
    const picked = pickDiverseComponents(
      [
        item('a', 'e1', 'over25', 0.9),
        item('b', 'e2', 'over25', 0.85),
        item('c', 'e3', 'over25', 0.8),
        item('d', 'e4', 'btts', 0.5),
      ],
      { size: 4 },
    );
    expect(picked.map((p) => p.id)).toEqual(['a', 'd']);
  });

  it('can require a distinct league when asked', () => {
    const pool = [
      item('a', 'e1', 'm1', 0.9, 'EPL'),
      item('b', 'e2', 'm2', 0.8, 'EPL'),
      item('c', 'e3', 'm3', 0.7, 'LALIGA'),
    ];

    expect(pickDiverseComponents(pool, { size: 3 }).map((p) => p.id)).toEqual([
      'a',
      'b',
      'c',
    ]);
    expect(
      pickDiverseComponents(pool, { size: 3, requireDistinctLeague: true }).map(
        (p) => p.id,
      ),
    ).toEqual(['a', 'c']);
  });

  it('respects the size limit', () => {
    const pool = Array.from({ length: 10 }, (_, i) =>
      item(`i${i}`, `e${i}`, `m${i}`, 1 - i / 10),
    );
    expect(pickDiverseComponents(pool, { size: 4 })).toHaveLength(4);
  });

  it('skips components already spent on an earlier cluster', () => {
    const pool = [
      item('a', 'e1', 'm1', 0.9),
      item('b', 'e2', 'm2', 0.8),
      item('c', 'e3', 'm3', 0.7),
    ];
    const picked = pickDiverseComponents(pool, { size: 3, used: new Set(['a']) });
    expect(picked.map((p) => p.id)).toEqual(['b', 'c']);
  });

  it('returns fewer than requested rather than repeating anything', () => {
    const picked = pickDiverseComponents(
      [item('a', 'e1', 'm1', 0.9), item('b', 'e1', 'm1', 0.8)],
      { size: 4 },
    );
    expect(picked).toHaveLength(1);
    expect(picked.length).toBeLessThan(MIN_CLUSTER_SIZE);
  });

  it('handles an empty pool', () => {
    expect(pickDiverseComponents([], { size: 4 })).toEqual([]);
  });
});

describe('combinedProbability', () => {
  /**
   * The number that stops a cluster reading as four near-certainties.
   * Four selections at 85% is close to a coin flip.
   */
  it('multiplies, and four strong components land near half', () => {
    const four = combinedProbability([
      { hitRate: 0.85 },
      { hitRate: 0.85 },
      { hitRate: 0.85 },
      { hitRate: 0.85 },
    ]);
    expect(four).toBeCloseTo(0.522, 3);
    expect(four).toBeLessThan(0.55);
  });

  it('falls as components are added', () => {
    const two = combinedProbability([{ hitRate: 0.8 }, { hitRate: 0.8 }]);
    const three = combinedProbability([
      { hitRate: 0.8 },
      { hitRate: 0.8 },
      { hitRate: 0.8 },
    ]);
    expect(two).toBeCloseTo(0.64, 6);
    expect(three).toBeCloseTo(0.512, 6);
    expect(three).toBeLessThan(two);
  });

  it('is zero for an empty cluster', () => {
    expect(combinedProbability([])).toBe(0);
  });

  it('never exceeds its weakest component', () => {
    const components = [{ hitRate: 0.95 }, { hitRate: 0.6 }, { hitRate: 0.9 }];
    expect(combinedProbability(components)).toBeLessThanOrEqual(0.6);
  });
});

describe('the cluster bar', () => {
  const { isClusterExcludedMarket, meetsClusterBar, trimToBar } = jest.requireActual('./cluster-selection');
  const leg = (id: string, hitRate: number) => ({ id, hitRate });

  it('keeps half-time and combination markets out', () => {
    expect(isClusterExcludedMarket('HTFT_TEAM_TEAM')).toBe(true); // leads at half-time and wins
    expect(isClusterExcludedMarket('HT_TEAM_WIN')).toBe(true);
    expect(isClusterExcludedMarket('TEAM_SCORE_BOTH_HALVES')).toBe(true);
    expect(isClusterExcludedMarket('TEAM_WIN_AND_BTTS')).toBe(true);
    expect(isClusterExcludedMarket('TEAM_UNDER_1_5')).toBe(false);
    expect(isClusterExcludedMarket('DOUBLE_CHANCE_TEAM_OR_DRAW')).toBe(false);
  });

  it('needs 60% and keeps emerging runs out unless they passed the test', () => {
    const base = { marketId: 'TEAM_UNDER_1_5', emerging: false, survivedGate: true };
    expect(meetsClusterBar({ ...base, chance: 0.61 }, 0.6)).toBe(true);
    expect(meetsClusterBar({ ...base, chance: 0.18 }, 0.6)).toBe(false);
    expect(meetsClusterBar({ ...base, chance: 0.7, emerging: true, survivedGate: false }, 0.6)).toBe(false);
  });

  it('drops the least likely selection until the cluster reaches 20%', () => {
    // 0.7 × 0.65 × 0.6 = 27% — fine as it is.
    expect(trimToBar([leg('a', 0.7), leg('b', 0.65), leg('c', 0.6)], 0.2)?.map((l: { id: string }) => l.id)).toEqual(['a', 'b', 'c']);
    // 0.5 × 0.45 × 0.4 = 9%; the best two make 22.5%.
    expect(trimToBar([leg('a', 0.5), leg('b', 0.45), leg('c', 0.4)], 0.2)?.map((l: { id: string }) => l.id)).toEqual(['a', 'b']);
    // Nothing reaches 20%: no cluster rather than a long shot.
    expect(trimToBar([leg('a', 0.4), leg('b', 0.4)], 0.2)).toBeNull();
  });
});
