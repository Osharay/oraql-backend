import { calibrate } from './calibration';

describe('calibrate', () => {
  it('counts wins and losses per band and splits strong (60%+) from the rest', () => {
    const c = calibrate([
      { probability: 0.65, result: 'WIN' },
      { probability: 0.62, result: 'LOSS' },
      { probability: 0.95, result: 'WIN' },
      { probability: 0.55, result: 'LOSS' },
      { probability: 0.3, result: 'VOID' },
      { probability: 1, result: 'WIN' },
    ]);
    const band = (from: number) => c.bands.find((b) => b.from === from)!;
    expect([band(0.6).settled, band(0.6).won]).toEqual([2, 1]);
    expect([band(0.9).settled, band(0.9).won, band(0.9).to]).toEqual([2, 2, 1]);
    expect(band(0).settled).toBe(0); // the void is left out
    expect([c.strong.settled, c.strong.won]).toEqual([4, 3]);
    expect([c.weak.settled, c.weak.won]).toEqual([1, 0]);
  });
});
