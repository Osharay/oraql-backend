import {
  shrunkRate,
  combineSides,
  confidenceOf,
  compareBoard,
  type BoardRow,
} from './market-board';

describe('shrunkRate', () => {
  it('pulls a perfect short record back towards the market', () => {
    // 5 from 5 on a 50% market is not a 100% market.
    expect(shrunkRate(5, 5, 0.5)).toBeCloseTo(10 / 15);
  });

  it('barely moves a long record', () => {
    expect(shrunkRate(60, 80, 0.5)).toBeCloseTo(65 / 90);
    expect(shrunkRate(60, 80, 0.5)).toBeGreaterThan(0.7);
  });

  it('returns the market rate when there is nothing to go on', () => {
    expect(shrunkRate(0, 0, 0.62)).toBeCloseTo(0.62);
  });

  it('falls back to a half without a baseline rather than inventing one', () => {
    expect(shrunkRate(0, 0, null)).toBeCloseTo(0.5);
    expect(shrunkRate(4, 4, null)).toBeCloseTo(9 / 14);
  });

  it('shrinks a poor record upwards, not only a good one down', () => {
    expect(shrunkRate(0, 4, 0.5)).toBeCloseTo(5 / 14);
  });

  it('never leaves the unit interval', () => {
    for (const [w, n] of [[0, 0], [0, 50], [50, 50], [3, 7]]) {
      const p = shrunkRate(w, n, 0.5);
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(1);
    }
  });
});

describe('combineSides', () => {
  it('averages the two sides rather than multiplying them', () => {
    // 8/10 and 2/10 is a fixture around the middle, not 16%.
    const c = combineSides(
      [
        { label: 'home', wins: 8, played: 10 },
        { label: 'away', wins: 2, played: 10 },
      ],
      0.5,
    );
    expect(c.probability).toBeCloseTo(15 / 30);
  });

  it('weights the side with more history more heavily', () => {
    const c = combineSides(
      [
        { label: 'long', wins: 30, played: 30 },
        { label: 'short', wins: 0, played: 2 },
      ],
      0.5,
    );
    expect(c.probability).toBeGreaterThan(0.7);
  });

  it('gives the market rate when neither side has played', () => {
    const c = combineSides(
      [
        { label: 'home', wins: 0, played: 0 },
        { label: 'away', wins: 0, played: 0 },
      ],
      0.44,
    );
    expect(c.probability).toBeCloseTo(0.44);
    expect(c.played).toBe(0);
  });
});

describe('confidenceOf', () => {
  it('bands by matches behind the row', () => {
    expect(confidenceOf(0)).toBe('none');
    expect(confidenceOf(9)).toBe('low');
    expect(confidenceOf(10)).toBe('medium');
    expect(confidenceOf(24)).toBe('medium');
    expect(confidenceOf(25)).toBe('high');
  });
});

describe('compareBoard', () => {
  const row = (over: Partial<BoardRow>): BoardRow => ({
    probability: 0.5,
    baselineRate: 0.5,
    edge: 0,
    played: 20,
    confidence: 'medium',
    currentRun: 0,
    ...over,
  });

  it('ranks by probability by default', () => {
    const low = row({ probability: 0.6 });
    const high = row({ probability: 0.9 });
    expect([low, high].sort(compareBoard())[0]).toBe(high);
  });

  it('keeps rows with no evidence at the bottom whatever their estimate', () => {
    const empty = row({ probability: 0.95, played: 0, confidence: 'none' });
    const real = row({ probability: 0.55 });
    expect([empty, real].sort(compareBoard())[0]).toBe(real);
  });

  it('can rank by what the fixture adds over the market', () => {
    const popular = row({ probability: 0.95, edge: 0.02 });
    const unusual = row({ probability: 0.7, edge: 0.25 });
    expect([popular, unusual].sort(compareBoard('edge'))[0]).toBe(unusual);
  });

  it('can rank by the current run', () => {
    const streak = row({ currentRun: 9, probability: 0.6 });
    const none = row({ currentRun: 0, probability: 0.9 });
    expect([none, streak].sort(compareBoard('run'))[0]).toBe(streak);
  });

  it('can put the best-evidenced rows first', () => {
    const thin = row({ confidence: 'low', probability: 0.99, played: 4 });
    const solid = row({ confidence: 'high', probability: 0.7, played: 60 });
    expect([thin, solid].sort(compareBoard('confidence'))[0]).toBe(solid);
  });

  it('breaks a probability tie on the longer record', () => {
    const short = row({ played: 12 });
    const long = row({ played: 60 });
    expect([short, long].sort(compareBoard())[0]).toBe(long);
  });
});
