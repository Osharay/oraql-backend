import { binomialUpperTail, benjaminiHochberg } from './stats.util';

/**
 * The gate's behaviour as an executable claim.
 *
 * Unit tests prove the maths is right; these prove the maths is being used in
 * a way that produces a usable engine. They are the regression guard for the
 * decisions the thresholds encode — if someone lowers the sample floor or
 * drops the correction to make the feed look busier, these fail.
 *
 * Deterministic: the generator is seeded.
 */

const ALPHA = 0.1;
const BASELINES = [0.8, 0.75, 0.52, 0.5, 0.48, 0.45];

function makeRng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

function run(opts: {
  seed: number;
  nullSlices: number;
  realSlices: number;
  n: number;
  edge: number;
}) {
  const rnd = makeRng(opts.seed);
  const draw = (n: number, p: number) => {
    let w = 0;
    for (let i = 0; i < n; i++) if (rnd() < p) w++;
    return w;
  };

  const slices: Array<{ wins: number; n: number; baseline: number; real: boolean }> = [];

  for (let i = 0; i < opts.nullSlices; i++) {
    const baseline = BASELINES[i % BASELINES.length];
    slices.push({ wins: draw(opts.n, baseline), n: opts.n, baseline, real: false });
  }
  for (let i = 0; i < opts.realSlices; i++) {
    const baseline = BASELINES[i % BASELINES.length];
    const rate = Math.min(baseline + opts.edge, 0.97);
    slices.push({ wins: draw(opts.n, rate), n: opts.n, baseline, real: true });
  }

  const p = slices.map((s) => binomialUpperTail(s.wins, s.n, s.baseline));
  const q = benjaminiHochberg(p);

  let truePositives = 0;
  let falsePositives = 0;
  let uncorrectedFalsePositives = 0;

  slices.forEach((s, i) => {
    const survived = q[i] <= ALPHA && s.wins / s.n - s.baseline > 0;
    if (survived && s.real) truePositives++;
    if (survived && !s.real) falsePositives++;
    if (p[i] < 0.05 && !s.real) uncorrectedFalsePositives++;
  });

  return { truePositives, falsePositives, uncorrectedFalsePositives };
}

describe('gate behaviour', () => {
  it('keeps false discoveries near the target rate', () => {
    const r = run({ seed: 42, nullSlices: 1000, realSlices: 25, n: 110, edge: 0.18 });
    const discoveries = r.truePositives + r.falsePositives;
    expect(discoveries).toBeGreaterThan(0);
    // FDR should sit near ALPHA, with slack for one seeded sample.
    expect(r.falsePositives / discoveries).toBeLessThan(0.3);
  });

  it('still finds most genuine signals at a realistic sample size', () => {
    const r = run({ seed: 42, nullSlices: 1000, realSlices: 25, n: 110, edge: 0.18 });
    expect(r.truePositives).toBeGreaterThanOrEqual(15);
  });

  it('suppresses far more noise than an uncorrected engine would show', () => {
    const r = run({ seed: 42, nullSlices: 1000, realSlices: 25, n: 110, edge: 0.18 });
    expect(r.uncorrectedFalsePositives).toBeGreaterThan(r.falsePositives * 5);
  });

  /**
   * The finding that set the sample floor: shallow history cannot clear the
   * gate however wide the search. If this ever starts passing, the thresholds
   * have been loosened and the feed is showing noise again.
   */
  it('finds almost nothing on shallow history, and that is correct', () => {
    const r = run({ seed: 7, nullSlices: 12000, realSlices: 25, n: 30, edge: 0.18 });
    expect(r.truePositives).toBeLessThan(5);
    expect(r.falsePositives).toBeLessThan(5);
  });

  it('recovers those same signals once history is deep enough', () => {
    const shallow = run({ seed: 7, nullSlices: 1000, realSlices: 25, n: 30, edge: 0.18 });
    const deep = run({ seed: 7, nullSlices: 1000, realSlices: 25, n: 120, edge: 0.18 });
    expect(deep.truePositives).toBeGreaterThan(shallow.truePositives * 3);
  });
});
