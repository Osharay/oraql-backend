import { combinedChance, conflictBetween } from './builder-math';

const m = (name: string, category = 'GOALS', shortName?: string) => ({ name, category, shortName });

describe('conflictBetween', () => {
  it('catches Over/Under on the same line in either order', () => {
    expect(conflictBetween(m('Match Goals: Over 2.5'), m('Match Goals: Under 2.5'))).not.toBeNull();
    expect(conflictBetween(m('Match Goals: Under 2.5'), m('Match Goals: Over 2.5'))).not.toBeNull();
  });

  it('catches impossible ranges, allows possible ones', () => {
    expect(conflictBetween(m('Match Goals: Over 2.5'), m('Match Goals: Under 1.5'))).not.toBeNull();
    expect(conflictBetween(m('Match Goals: Over 1.5'), m('Match Goals: Under 3.5'))).toBeNull();
  });

  it('does not mix different counts or teams', () => {
    expect(conflictBetween(m('Match Goals: Over 2.5'), m('Match Corners: Under 2.5', 'CORNERS'))).toBeNull();
    expect(conflictBetween(m('Arsenal Goals: Over 0.5'), m('Chelsea Goals: Under 0.5'))).toBeNull();
    expect(conflictBetween(m('Arsenal Goals: Over 0.5'), m('Arsenal Goals: Under 0.5'))).not.toBeNull();
  });

  it('catches two different match results and both BTTS sides', () => {
    expect(conflictBetween(m('Arsenal to Win', 'MATCH_RESULT', '1'), m('Draw', 'MATCH_RESULT', 'X'))).not.toBeNull();
    expect(
      conflictBetween(m('Both Teams to Score — Yes'), m('Both Teams to Score — No')),
    ).not.toBeNull();
    expect(conflictBetween(m('Both Teams to Score — Yes'), m('Match Goals: Over 2.5'))).toBeNull();
  });
});

describe('combinedChance', () => {
  it('multiplies legs from different matches', () => {
    const c = combinedChance([
      { eventId: 'a', probability: 0.8 },
      { eventId: 'b', probability: 0.5 },
    ]);
    expect(c.probability).toBeCloseTo(0.4);
    expect(c.low).toBeCloseTo(0.4);
    expect(c.high).toBeCloseTo(0.4);
    expect(c.sharedMatches).toBe(0);
  });

  it('gives a range, not a product, for legs from the same match', () => {
    // Over 1.5 (0.8) and Over 2.5 (0.55): the product 0.44 is wrong — the
    // second implies the first, so the true joint is 0.55.
    const c = combinedChance([
      { eventId: 'a', probability: 0.8 },
      { eventId: 'a', probability: 0.55 },
    ]);
    expect(c.probability).toBeNull();
    expect(c.high).toBeCloseTo(0.55);
    expect(c.low).toBeCloseTo(0.35);
    expect(c.sharedMatches).toBe(1);
  });

  it('never goes below zero', () => {
    const c = combinedChance([
      { eventId: 'a', probability: 0.3 },
      { eventId: 'a', probability: 0.3 },
    ]);
    expect(c.low).toBe(0);
  });

  it('combines shared and separate matches', () => {
    const c = combinedChance([
      { eventId: 'a', probability: 0.8 },
      { eventId: 'a', probability: 0.6 },
      { eventId: 'b', probability: 0.5 },
    ]);
    expect(c.high).toBeCloseTo(0.3);
    expect(c.low).toBeCloseTo(0.2);
  });
});
