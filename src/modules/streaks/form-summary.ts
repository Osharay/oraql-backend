import { binomialUpperTail } from './stats.util';

/**
 * Recent form for one market, with the longer record beside it.
 *
 * From the client: "the data that is to be considered should be restricted
 * ... five, ten matches, because five is like the most recent thing telling
 * you this is the form of the team as at now", and the rest is "extra data to
 * weigh what you have against — more like a standard deviation".
 *
 * So the recent run leads, and three things sit beside it: the team's record
 * over the longer window, what the market usually does, and how often a run
 * like this happens by luck alone. That last one matters because at ten
 * matches luck is common — a market that lands 60% of the time goes five for
 * five about one time in thirteen.
 */

export type Settled = 'WIN' | 'LOSS';

export type ChanceBand = 'rare' | 'unusual' | 'common';

export interface MarketForm {
  /** Newest first, e.g. "WWLWW" — at most `window` long. */
  recent: string;
  recentWins: number;
  recentPlayed: number;
  recentRate: number;
  /** Consecutive wins from the most recent match backwards. */
  currentRun: number;
  /** Over the whole lookback (about two seasons). */
  longWins: number;
  longPlayed: number;
  longRate: number;
  /** How often this market lands in general, for this league. */
  baselineRate: number | null;
  /** Recent rate minus the market's usual rate. */
  lift: number | null;
  /**
   * Probability of at least this many wins in the recent window by chance,
   * if the team were simply ordinary at this market.
   */
  chance: number | null;
  chanceBand: ChanceBand | null;
}

export function chanceBand(p: number): ChanceBand {
  if (p < 0.01) return 'rare';
  if (p < 0.05) return 'unusual';
  return 'common';
}

/**
 * @param results newest first, settled only
 * @param window  how many recent matches count as current form
 * @param baselineRate the market's usual rate, or null if unknown
 */
export function summariseForm(
  results: Settled[],
  window: number,
  baselineRate: number | null,
): MarketForm {
  const recentResults = results.slice(0, window);
  const recentWins = recentResults.filter((r) => r === 'WIN').length;
  const recentPlayed = recentResults.length;
  const recentRate = recentPlayed ? recentWins / recentPlayed : 0;

  let currentRun = 0;
  for (const r of results) {
    if (r !== 'WIN') break;
    currentRun++;
  }

  const longWins = results.filter((r) => r === 'WIN').length;
  const longPlayed = results.length;

  const haveBaseline = baselineRate != null && baselineRate > 0 && baselineRate < 1;
  const chance =
    haveBaseline && recentPlayed > 0
      ? binomialUpperTail(recentWins, recentPlayed, baselineRate as number)
      : null;

  return {
    recent: recentResults.map((r) => (r === 'WIN' ? 'W' : 'L')).join(''),
    recentWins,
    recentPlayed,
    recentRate,
    currentRun,
    longWins,
    longPlayed,
    longRate: longPlayed ? longWins / longPlayed : 0,
    baselineRate: baselineRate ?? null,
    lift: baselineRate != null ? recentRate - baselineRate : null,
    chance,
    chanceBand: chance == null ? null : chanceBand(chance),
  };
}

export type FormSort = 'lift' | 'rate' | 'run';

/**
 * Best first.
 *
 * Default is lift, not raw rate. Ranked by rate, the top of every team's list
 * would be the markets that land for everyone — under 4.5 goals, team over
 * 0.5 — which is the "always picking goal markets" the client noticed. Lift
 * surfaces what this team does that the market does not.
 */
export function compareForm(sort: FormSort) {
  return (a: MarketForm, b: MarketForm): number => {
    const byRun = b.currentRun - a.currentRun;
    const byRate = b.recentRate - a.recentRate;
    const byLift = (b.lift ?? -Infinity) - (a.lift ?? -Infinity);

    if (sort === 'run') return byRun || byLift || byRate;
    if (sort === 'rate') return byRate || byLift || byRun;
    return byLift || byRun || byRate;
  };
}
