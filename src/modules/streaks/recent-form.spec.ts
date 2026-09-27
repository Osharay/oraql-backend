import { formRate, isEmerging, recentFormContext, recentRecord } from './recent-form';

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

  it('does not flag an ordinary run or one too short to judge', () => {
    expect(isEmerging([...rep(W, 9), ...rep(L, 6)], 0.5)).toBe(false); // 60% vs 50%
    expect(isEmerging(rep(W, 6), 0.3)).toBe(false); // too few
  });

  it('packs it for the slice context', () => {
    const ctx = recentFormContext([...rep(W, 13), ...rep(L, 2), ...rep(L, 30)], 13 / 45, 0.45);
    expect(ctx.recent).toEqual({ wins: 13, played: 15 });
    expect(ctx.emerging).toBe(true);
    expect(ctx.formRate).toBeGreaterThan(0.45);
  });
});
