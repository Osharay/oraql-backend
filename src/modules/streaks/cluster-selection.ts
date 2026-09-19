/**
 * Cluster assembly rules, as pure functions.
 *
 * Kept out of the service so they can be tested without a database: these
 * decide what a user actually sees on the headline screen, and a mistake here
 * (a cluster of four near-identical markets, or a combined probability that
 * flatters) is a product failure rather than a crash.
 */

export interface Selectable {
  id: string;
  eventId: string;
  leagueId: string;
  marketDefinitionId: string;
  hitRate: number;
  strengthScore: number;
}

export interface DiversityOptions {
  size: number;
  /** Also require every component to come from a different league. */
  requireDistinctLeague?: boolean;
  /** Ids already spent on an earlier cluster in the same run. */
  used?: Set<string>;
}

/**
 * Greedy selection, strongest first, skipping anything that repeats an event
 * or a market already in the set.
 *
 * The market rule is the one that matters: four variations of "over 2.5" is
 * one idea repeated, not a cluster, and it also correlates hard — the whole
 * set would win or lose together.
 */
export function pickDiverseComponents<T extends Selectable>(
  pool: T[],
  options: DiversityOptions,
): T[] {
  const used = options.used ?? new Set<string>();
  const ranked = [...pool].sort((a, b) => b.strengthScore - a.strengthScore);

  const chosen: T[] = [];
  const events = new Set<string>();
  const markets = new Set<string>();
  const leagues = new Set<string>();

  for (const item of ranked) {
    if (chosen.length >= options.size) break;
    if (used.has(item.id)) continue;
    if (events.has(item.eventId)) continue;
    if (markets.has(item.marketDefinitionId)) continue;
    if (options.requireDistinctLeague && leagues.has(item.leagueId)) continue;

    chosen.push(item);
    events.add(item.eventId);
    markets.add(item.marketDefinitionId);
    leagues.add(item.leagueId);
  }

  return chosen;
}

/**
 * Product of component hit rates.
 *
 * An independence approximation, and always presented as one. Same-day
 * football correlates through weather, refereeing directives and league-wide
 * scoring trends, so the true joint probability sits a little below this.
 * Even so, it is far closer to the truth than the impression four strong-looking
 * rows give on their own.
 */
export function combinedProbability(components: Array<{ hitRate: number }>): number {
  if (components.length === 0) return 0;
  return components.reduce((p, c) => p * c.hitRate, 1);
}

/** A cluster of one is just a streak. */
export const MIN_CLUSTER_SIZE = 2;
