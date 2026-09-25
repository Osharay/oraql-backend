import { goalMultipliers, poissonOver, shiftOverProbability } from './injury-impact';

describe('goalMultipliers', () => {
  it('leaves goals alone when nobody is missing', () => {
    expect(goalMultipliers([], [])).toEqual({ home: 1, away: 1 });
  });

  it('lowers a side whose attackers are out, and only that side', () => {
    const m = goalMultipliers([{ position: 'Attacker', status: 'Out' }], []);
    expect(m.home).toBeLessThan(1);
    expect(m.away).toBe(1);
  });

  it('raises the opponent when defenders or the keeper are out', () => {
    const m = goalMultipliers([{ position: 'Goalkeeper', status: 'Out' }], []);
    expect(m.home).toBe(1);
    expect(m.away).toBeGreaterThan(1);
  });

  it('counts doubtful players half', () => {
    const out = goalMultipliers([{ position: 'Attacker', status: 'Out' }], []);
    const doubtful = goalMultipliers([{ position: 'Attacker', status: 'Doubtful' }], []);
    expect(1 - doubtful.home).toBeCloseTo((1 - out.home) / 2);
  });

  it('caps a long injury list', () => {
    const many = Array.from({ length: 20 }, () => ({ position: 'Attacker', status: 'Out' }));
    expect(goalMultipliers(many, []).home).toBeCloseTo(0.85);
  });
});

describe('shiftOverProbability', () => {
  it('is the identity at multiplier 1', () => {
    expect(shiftOverProbability(0.63, 2.5, 1)).toBe(0.63);
  });

  it('recovers the original rate before scaling', () => {
    const lambda = 2.7;
    const p = poissonOver(lambda, 2.5);
    expect(shiftOverProbability(p, 2.5, 1.1)).toBeCloseTo(poissonOver(lambda * 1.1, 2.5), 4);
  });

  it('moves Over and Under in opposite directions, keeping them summing to 1', () => {
    const over = 0.7;
    const shifted = shiftOverProbability(over, 0.5, 0.9);
    expect(shifted).toBeLessThan(over);
    const under = 1 - shifted;
    expect(under).toBeGreaterThan(1 - over);
    expect(shifted + under).toBeCloseTo(1);
  });
});
