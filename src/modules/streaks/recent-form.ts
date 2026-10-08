import { binomialUpperTail } from './stats.util';
import { engineSettings } from './engine-settings';

/**
 * Recent form, weighed against the long record rather than instead of it.
 *
 * The client's point: streaks are recent — ten, fifteen, twenty matches — and
 * two seasons of history averages them away. The engine's test still uses the
 * two seasons (that is what keeps it honest), but each slice also carries:
 *
 *  - a form rate: every match counts, the most recent most, halving every
 *    HALF_LIFE matches back, and pulled towards the long-run rate by PRIOR
 *    matches' worth so a hot fortnight cannot claim certainty;
 *  - the last RECENT_WINDOW matches as a plain record;
 *  - an "emerging" flag for runs that are strong in recent matches alone even
 *    where two seasons do not show it. Those are labelled as such and tracked
 *    like everything else, not promoted;
 *  - the chance shown to people (`chance`): the record pulled towards what the
 *    market usually does, nudged a little by form, never above 90%. The first
 *    week of results showed raw records and form-led picks running 5 to 8
 *    points high, so form now only adjusts the season figure.
 */

export const RECENT_WINDOW = 15;
/** The old half-life, kept for the tests that describe the weighting itself. */
export const HALF_LIFE = 8;
export const PRIOR = 5;
/** Emerging needs this many recent matches… */
export const EMERGING_MIN_MATCHES = 8;
/** …a recent rate at least this far above the market's usual rate… */
export const EMERGING_MIN_LIFT = 0.15;
/** …and a recent record this unlikely by chance at the usual rate. */
export const EMERGING_MAX_P = 0.01;

type Result = string; // 'WIN' | 'LOSS', newest first

export function recentRecord(results: Result[], window = RECENT_WINDOW) {
  const recent = results.slice(0, window);
  return { wins: recent.filter((r) => r === 'WIN').length, played: recent.length };
}

/**
 * Exponentially weighted hit rate, newest first, shrunk towards the long-run
 * rate. Weights halve every HALF_LIFE matches.
 */
export function formRate(results: Result[], longRate: number, halfLife = HALF_LIFE, prior = PRIOR): number {
  const decay = Math.pow(0.5, 1 / halfLife);
  let w = 1;
  let num = prior * longRate;
  let den = prior;
  for (const r of results) {
    num += w * (r === 'WIN' ? 1 : 0);
    den += w;
    w *= decay;
  }
  return den > 0 ? num / den : longRate;
}

/**
 * A record pulled towards the market's usual rate by `k` matches' worth of it:
 * 10 of 10 on a 55% market reads 75%, 40 of 44 reads 83%. A short perfect run
 * stops looking certain; a long one still earns a high figure.
 */
export function shrunkRate(wins: number, played: number, usualRate: number, k = engineSettings().shrinkMatches): number {
  const den = played + k;
  return den > 0 ? (wins + k * usualRate) / den : usualRate;
}

/**
 * The chance people see: the shrunk season figure, moved by recent form at
 * most `maxShift` either way, then held inside [min, max].
 */
export function honestChance(
  season: number,
  form: number,
  s: { formMaxShift: number; chanceMin: number; chanceMax: number } = engineSettings(),
): number {
  const nudged = Math.min(season + s.formMaxShift, Math.max(season - s.formMaxShift, form));
  return Math.min(s.chanceMax, Math.max(s.chanceMin, nudged));
}

/** Strong in recent matches alone, by a margin chance rarely produces. */
export function isEmerging(
  results: Result[],
  baselineRate: number,
  minMatches = engineSettings().emergingMinMatches,
): boolean {
  const { wins, played } = recentRecord(results);
  if (played < minMatches) return false;
  if (wins / played - baselineRate < EMERGING_MIN_LIFT) return false;
  return binomialUpperTail(wins, played, baselineRate) <= EMERGING_MAX_P;
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** Hold a chance inside the shown range (5% to 90% by default); off, unchanged. */
export function capChance(p: number, s = engineSettings()): number {
  if (!s.honestChance) return p;
  return Math.min(s.chanceMax, Math.max(s.chanceMin, p));
}

/** What a slice stores about its recent form (in its context). */
export function recentFormContext(results: Result[], hitRate: number, baselineRate: number) {
  const s = engineSettings();
  if (!s.honestChance) {
    // The old behaviour: form pulled towards the raw record, no chance field.
    return {
      formRate: r3(formRate(results, hitRate)),
      recent: recentRecord(results),
      emerging: isEmerging(results, baselineRate, EMERGING_MIN_MATCHES),
    };
  }
  const wins = results.filter((r) => r === 'WIN').length;
  const season = shrunkRate(wins, results.length, baselineRate, s.shrinkMatches);
  const form = formRate(results, season, s.formHalfLife);
  return {
    formRate: r3(form),
    seasonRate: r3(season),
    chance: r3(honestChance(season, form, s)),
    recent: recentRecord(results),
    emerging: isEmerging(results, baselineRate, s.emergingMinMatches),
  };
}

/**
 * The chance a slice shows, from its stored context: the honest chance where
 * the run recorded one, else what it showed then (form, else the raw record).
 * Past picks keep the figure they were published with.
 */
export function shownChance(context: unknown, hitRate: number): number {
  const c = (context ?? {}) as { chance?: number; formRate?: number };
  if (typeof c.chance === 'number') return c.chance;
  if (typeof c.formRate === 'number') return c.formRate;
  return hitRate;
}
