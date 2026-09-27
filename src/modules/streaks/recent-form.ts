import { binomialUpperTail } from './stats.util';

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
 *    like everything else, not promoted.
 */

export const RECENT_WINDOW = 15;
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

/** Strong in recent matches alone, by a margin chance rarely produces. */
export function isEmerging(results: Result[], baselineRate: number): boolean {
  const { wins, played } = recentRecord(results);
  if (played < EMERGING_MIN_MATCHES) return false;
  if (wins / played - baselineRate < EMERGING_MIN_LIFT) return false;
  return binomialUpperTail(wins, played, baselineRate) <= EMERGING_MAX_P;
}

/** What a slice stores about its recent form (in its context). */
export function recentFormContext(results: Result[], hitRate: number, baselineRate: number) {
  return {
    formRate: Math.round(formRate(results, hitRate) * 1000) / 1000,
    recent: recentRecord(results),
    emerging: isEmerging(results, baselineRate),
  };
}
