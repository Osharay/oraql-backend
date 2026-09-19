import {
  logGamma,
  logChoose,
  binomialUpperTail,
  benjaminiHochberg,
  streakLengths,
  windowedVariance,
} from './stats.util';

describe('logGamma and logChoose', () => {
  it('matches known factorials', () => {
    expect(Math.exp(logGamma(5))).toBeCloseTo(24, 6); // 4!
    expect(Math.exp(logGamma(6))).toBeCloseTo(120, 5); // 5!
    expect(Math.exp(logGamma(11))).toBeCloseTo(3628800, 1); // 10!
  });

  it('handles the reflection case', () => {
    expect(logGamma(0.5)).toBeCloseTo(Math.log(Math.sqrt(Math.PI)), 9);
  });

  it('matches known binomial coefficients', () => {
    expect(Math.exp(logChoose(10, 3))).toBeCloseTo(120, 6);
    expect(Math.exp(logChoose(52, 5))).toBeCloseTo(2598960, 1);
    expect(logChoose(5, 6)).toBe(-Infinity);
  });
});

describe('binomialUpperTail', () => {
  it('matches hand-computed values', () => {
    expect(binomialUpperTail(1, 1, 0.5)).toBeCloseTo(0.5, 12);
    expect(binomialUpperTail(2, 2, 0.5)).toBeCloseTo(0.25, 12);
    expect(binomialUpperTail(8, 10, 0.5)).toBeCloseTo(0.0546875, 12); // 56/1024
    expect(binomialUpperTail(10, 10, 0.5)).toBeCloseTo(1 / 1024, 12);
  });

  it('covers the whole range at k=0', () => {
    expect(binomialUpperTail(0, 10, 0.3)).toBeCloseTo(1, 12);
  });

  it('is impossible to exceed n', () => {
    expect(binomialUpperTail(11, 10, 0.5)).toBe(0);
  });

  /**
   * The behaviour the whole engine rests on: a run is only interesting
   * relative to what that market does anyway.
   */
  it('treats 9/10 as unremarkable on a market that lands 80% of the time', () => {
    expect(binomialUpperTail(9, 10, 0.8)).toBeGreaterThan(0.2);
  });

  it('treats the same 9/10 as notable on a 48% market', () => {
    expect(binomialUpperTail(9, 10, 0.48)).toBeLessThan(0.02);
  });

  it('would wrongly flag the 80% market if tested against 0.5', () => {
    // Guards against anyone "simplifying" the baseline away later.
    expect(binomialUpperTail(9, 10, 0.5)).toBeLessThan(0.02);
    expect(binomialUpperTail(9, 10, 0.8)).toBeGreaterThan(0.2);
  });
});

describe('benjaminiHochberg', () => {
  it('matches the classic worked example', () => {
    const q = benjaminiHochberg([0.005, 0.011, 0.02, 0.04, 0.13]);
    expect(q[0]).toBeCloseTo(0.025, 9);
    expect(q[1]).toBeCloseTo(0.0275, 9);
    expect(q[2]).toBeCloseTo(0.0333333, 6);
    expect(q[3]).toBeCloseTo(0.05, 9);
    expect(q[4]).toBeCloseTo(0.13, 9);
  });

  it('returns values in the caller original order', () => {
    const q = benjaminiHochberg([0.13, 0.005, 0.04, 0.011, 0.02]);
    expect(q[1]).toBeCloseTo(0.025, 9);
    expect(q[0]).toBeCloseTo(0.13, 9);
  });

  it('is monotonic and bounded', () => {
    const q = benjaminiHochberg([0.001, 0.002, 0.3, 0.31, 0.9]);
    for (let i = 1; i < q.length; i++) {
      expect(q[i]).toBeGreaterThanOrEqual(q[i - 1] - 1e-12);
    }
    for (const v of q) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('handles an empty run', () => {
    expect(benjaminiHochberg([])).toEqual([]);
  });

  /** Search width is the point: one lucky p=0.01 among 10,000 tests is nothing. */
  it('suppresses a lone p=0.01 among ten thousand tests', () => {
    const q = benjaminiHochberg([0.01, ...Array(9999).fill(0.5)]);
    expect(q[0]).toBeGreaterThan(0.05);
  });
});

describe('streakLengths', () => {
  it('separates the current run from the longest', () => {
    expect(streakLengths(['WIN', 'WIN', 'WIN', 'LOSS', 'WIN'])).toEqual({
      current: 3,
      longest: 3,
    });
    expect(streakLengths(['LOSS', 'WIN', 'WIN', 'WIN', 'WIN'])).toEqual({
      current: 0,
      longest: 4,
    });
  });

  it('handles empty and all-win histories', () => {
    expect(streakLengths([])).toEqual({ current: 0, longest: 0 });
    expect(streakLengths(['WIN', 'WIN'])).toEqual({ current: 2, longest: 2 });
  });
});

describe('windowedVariance', () => {
  it('is zero for a perfectly consistent record', () => {
    expect(windowedVariance(Array(20).fill('WIN'), 5)).toBeCloseTo(0, 12);
  });

  it('returns null below two windows of history', () => {
    expect(windowedVariance(['WIN', 'LOSS'], 5)).toBeNull();
  });

  it('rises with swing between windows', () => {
    const steady = windowedVariance(
      ['WIN', 'LOSS', 'WIN', 'LOSS', 'WIN', 'WIN', 'LOSS', 'WIN', 'LOSS', 'WIN'],
      5,
    );
    const swinging = windowedVariance(
      ['WIN', 'WIN', 'WIN', 'WIN', 'WIN', 'LOSS', 'LOSS', 'LOSS', 'LOSS', 'LOSS'],
      5,
    );
    expect(swinging!).toBeGreaterThan(steady!);
  });
});
