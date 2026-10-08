import { formRate, honestChance, isEmerging, recentFormContext, recentRecord, shownChance, shrunkRate } from './recent-form';

const W = 'WIN';
const L = 'LOSS';
const rep = (r: string, n: number) => Array.from({ length: n }, () => r);

describe('recent form', () => {
  it('reads the last fifteen as a plain record', () => {
    expect(recentRecord([...rep(W, 12), ...rep(L, 3), ...rep(L, 40)])).toEqual({ wins: 12, played: 15 });
  });

  it('weights recent matches more than old ones', () => {
    const hotNow = [...rep(W, 10), ...rep(L, 40)]; // 20% overall, all wins lately
    const coldNow = [...rep(L, 10), ...rep(W, 10), ...rep(L, 30)]; // same 20%, wins long ago
    expect(formRate(hotNow, 0.2)).toBeGreaterThan(0.4); // more than double the 20% long run
    expect(formRate(coldNow, 0.2)).toBeLessThan(0.25);
  });

  it('does not let a short run claim certainty', () => {
    expect(formRate(rep(W, 6), 0.4)).toBeLessThan(0.9);
  });

  it('flags a strong recent run the long record does not show', () => {
    // 13 of the last 15 on a 45% market, after a poor spell: emerging.
    const results = [...rep(W, 13), ...rep(L, 2), ...rep(L, 30)];
    expect(isEmerging(results, 0.45)).toBe(true);
  });

  it('needs twelve recent matches to call a run emerging', () => {
    // 10 of 10 on a 30% market is striking, but ten matches are not enough now.
    expect(isEmerging([...rep(W, 10)], 0.3)).toBe(false);
    expect(isEmerging([...rep(W, 12)], 0.3)).toBe(true);
  });

  it('does not flag an ordinary run or one too short to judge', () => {
    expect(isEmerging([...rep(W, 9), ...rep(L, 6)], 0.5)).toBe(false); // 60% vs 50%
    expect(isEmerging(rep(W, 6), 0.3)).toBe(false); // too few
  });

  it('pulls a short perfect record towards the usual rate', () => {
    expect(shrunkRate(10, 10, 0.55)).toBeCloseTo(0.755, 2); // not 100%
    expect(shrunkRate(40, 44, 0.55)).toBeCloseTo(0.832, 2); // a long record earns more
    expect(shrunkRate(0, 0, 0.55)).toBe(0.55);
  });

  it('lets form move the chance five points at most, and caps it at 90%', () => {
    const s = { formMaxShift: 0.05, chanceMin: 0.05, chanceMax: 0.9 };
    expect(honestChance(0.6, 0.8, s)).toBeCloseTo(0.65, 5);
    expect(honestChance(0.6, 0.4, s)).toBeCloseTo(0.55, 5);
    expect(honestChance(0.6, 0.62, s)).toBeCloseTo(0.62, 5);
    expect(honestChance(0.95, 0.99, s)).toBe(0.9);
  });

  it('never shows a ten-match perfect run above 81%', () => {
    // 75.5% from the record, plus at most 5 points for the hot run.
    const ctx = recentFormContext(rep(W, 10), 1, 0.55);
    expect(ctx.chance).toBeLessThanOrEqual(0.81);
  });

  it('keeps the figure a past pick was published with', () => {
    expect(shownChance({ chance: 0.62, formRate: 0.7 }, 0.9)).toBe(0.62);
    expect(shownChance({ formRate: 0.7 }, 0.9)).toBe(0.7); // before the change
    expect(shownChance(null, 0.9)).toBe(0.9);
  });

  it('goes back to the old figures when the setting is off', () => {
    process.env.ORAQL_HONEST_CHANCE = 'off';
    try {
      const ctx = recentFormContext(rep(W, 10), 1, 0.55) as { chance?: number; formRate: number };
      expect(ctx.chance).toBeUndefined();
      expect(ctx.formRate).toBeGreaterThan(0.95);
    } finally {
      delete process.env.ORAQL_HONEST_CHANCE;
    }
  });

  it('packs it for the slice context', () => {
    const ctx = recentFormContext([...rep(W, 13), ...rep(L, 2), ...rep(L, 30)], 13 / 45, 0.45);
    expect(ctx.recent).toEqual({ wins: 13, played: 15 });
    expect(ctx.emerging).toBe(true);
    expect(ctx.formRate).toBeGreaterThan(ctx.seasonRate!); // hot lately
    expect(ctx.chance).toBeCloseTo(ctx.seasonRate! + 0.05, 5); // but moved 5 points at most
    expect(ctx.chance).toBeGreaterThan(0.3);
    expect(ctx.chance).toBeLessThan(0.6); // 13 of 45 overall: form only nudges it
  });
});
