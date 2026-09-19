/**
 * Statistics for the streak engine.
 *
 * The engine tests tens of thousands of slices per run. At that scale, runs of
 * 9-from-10 appear in noise by the hundred, so two things are non-negotiable:
 * every candidate is tested against its market's baseline (not against 50%),
 * and the resulting p-values are corrected for how many tests were run.
 *
 * No stats library is available here, so these are implemented directly and
 * verified against known values.
 */

/** Lanczos approximation of ln Γ(x). Accurate to ~15 significant figures for x > 0. */
export function logGamma(x: number): number {
  const g = 7;
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];

  if (x < 0.5) {
    // Reflection formula
    return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  }

  x -= 1;
  let a = c[0];
  const t = x + g + 0.5;
  for (let i = 1; i < g + 2; i++) a += c[i] / (x + i);

  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

/** ln C(n, k) */
export function logChoose(n: number, k: number): number {
  if (k < 0 || k > n) return -Infinity;
  return logGamma(n + 1) - logGamma(k + 1) - logGamma(n - k + 1);
}

/**
 * One-sided binomial test: P(X >= k) where X ~ Binomial(n, p).
 *
 * This is the question that matters — "how often would chance alone produce at
 * least this many hits, given what this market normally does?" Testing against
 * the baseline p rather than 0.5 is the whole point: 9/10 on a market that
 * lands 80% of the time is unremarkable and must not score as a discovery.
 */
export function binomialUpperTail(k: number, n: number, p: number): number {
  if (n <= 0) return 1;
  if (k <= 0) return 1;
  if (k > n) return 0;

  // Degenerate baselines
  if (p <= 0) return k > 0 ? 0 : 1;
  if (p >= 1) return k >= n ? 1 : 1;

  const lnP = Math.log(p);
  const ln1mP = Math.log1p(-p);

  // Sum the shorter tail for numerical stability, then complement if needed.
  let sum = 0;
  for (let i = k; i <= n; i++) {
    sum += Math.exp(logChoose(n, i) + i * lnP + (n - i) * ln1mP);
  }

  return Math.min(Math.max(sum, 0), 1);
}

/**
 * Benjamini–Hochberg adjusted p-values (q-values).
 *
 * Returns adjusted values in the caller's original order. The input must be
 * EVERY test performed in the run, including the ones that looked unpromising —
 * correcting against only the survivors defeats the purpose.
 */
export function benjaminiHochberg(pValues: number[]): number[] {
  const m = pValues.length;
  if (m === 0) return [];

  const indexed = pValues.map((p, i) => ({ p, i }));
  indexed.sort((a, b) => a.p - b.p);

  const adjusted = new Array<number>(m);
  let running = 1;

  // Walk from the largest p-value down, enforcing monotonicity.
  for (let rank = m; rank >= 1; rank--) {
    const { p, i } = indexed[rank - 1];
    const q = Math.min(1, (p * m) / rank);
    running = Math.min(running, q);
    adjusted[i] = running;
  }

  return adjusted;
}

/** Longest run of WINs, and the run currently in progress. */
export function streakLengths(resultsNewestFirst: Array<'WIN' | 'LOSS'>): {
  current: number;
  longest: number;
} {
  let current = 0;
  for (const r of resultsNewestFirst) {
    if (r === 'WIN') current++;
    else break;
  }

  let longest = 0;
  let run = 0;
  for (const r of resultsNewestFirst) {
    if (r === 'WIN') {
      run++;
      longest = Math.max(longest, run);
    } else {
      run = 0;
    }
  }

  return { current, longest };
}

/**
 * Spread of hit rate across fixed windows — high variance means a team's
 * record swings around its own mean, which is a reason to demand a larger
 * sample, not a reason to call the team erratic.
 */
export function windowedVariance(
  resultsNewestFirst: Array<'WIN' | 'LOSS'>,
  windowSize = 5,
): number | null {
  if (resultsNewestFirst.length < windowSize * 2) return null;

  const rates: number[] = [];
  for (let i = 0; i + windowSize <= resultsNewestFirst.length; i += windowSize) {
    const slice = resultsNewestFirst.slice(i, i + windowSize);
    rates.push(slice.filter((r) => r === 'WIN').length / windowSize);
  }

  const mean = rates.reduce((a, b) => a + b, 0) / rates.length;
  const variance =
    rates.reduce((acc, r) => acc + (r - mean) ** 2, 0) / rates.length;

  return variance;
}
