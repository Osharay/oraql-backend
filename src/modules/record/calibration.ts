/**
 * How often OraQL's chances came true, by band — the check that a "70%" pick
 * lands about 7 times in 10. Wins and losses only; voids are left out.
 */
export const STRONG_CHANCE = 0.6;

const BANDS: Array<[number, number]> = [
  [0, 0.5],
  [0.5, 0.6],
  [0.6, 0.7],
  [0.7, 0.8],
  [0.8, 0.9],
  [0.9, 1.0001],
];

export interface Calibrated {
  from: number;
  to: number;
  settled: number;
  won: number;
  rate: number | null;
  expected: number | null;
}

export function calibrate(items: Array<{ probability: number; result: string }>) {
  const counted = items.filter((i) => i.result === 'WIN' || i.result === 'LOSS');
  const rateOf = (xs: typeof counted, from: number, to: number): Calibrated => {
    const won = xs.filter((i) => i.result === 'WIN').length;
    return {
      from,
      to: Math.min(to, 1),
      settled: xs.length,
      won,
      rate: xs.length ? won / xs.length : null,
      expected: xs.length ? xs.reduce((n, i) => n + i.probability, 0) / xs.length : null,
    };
  };
  return {
    bands: BANDS.map(([a, b]) => rateOf(counted.filter((i) => i.probability >= a && i.probability < b), a, b)),
    strong: rateOf(counted.filter((i) => i.probability >= STRONG_CHANCE), STRONG_CHANCE, 1),
    weak: rateOf(counted.filter((i) => i.probability < STRONG_CHANCE), 0, STRONG_CHANCE),
  };
}
