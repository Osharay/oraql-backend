/**
 * Which competitions are worth holding, and in what order to cover them.
 *
 * Taking every fixture the provider returns was right — the six hand-listed
 * leagues left most of the card invisible — but it also brought in U19
 * leagues, youth tournaments, international friendlies and the sixth series
 * of a third division. Those have almost no history to measure, are barely
 * priced by bookmakers, and every one of them that reaches the engine adds a
 * test that every real finding then has to beat.
 *
 * So the breadth stays and the noise goes. Pure and tested: which
 * competitions are excluded is a judgement about the product, and it should
 * be readable and changeable without touching the ingest.
 */

/** Age-group, youth, reserve and exhibition football. */
const EXCLUDED_PATTERNS: RegExp[] = [
  /\bu-?1[0-9]\b/i, // U15 … U19
  /\bu-?2[0-3]\b/i, // U20 … U23
  /\byouth\b/i,
  /\bjunior/i,
  /\bprimavera\b/i, // Italy's youth league
  /\bacademy\b/i,
  /\breserve/i, // Reserve, Reserves
  /\bfriendl/i, // Friendlies, Friendly
  /\btrial\b/i,
  /\bamateur\b/i,
  /\bveteran/i,
];

/**
 * Third tier and below, where our own history is thin and prices are thinner.
 * Kept separate from the hard exclusions: these are real competitions, just
 * last in the queue.
 */
const LOW_TIER_PATTERNS: RegExp[] = [
  /\bliga\s+iii\b/i,
  /\b(third|3rd)\s+(division|league)\b/i,
  /\bdivision\s+(3|4|5)\b/i,
  /\bregional/i,
  /\bserie\s+d\b/i,
  /\boberliga\b/i,
  /\bliga\s+alef\b/i,
  /\bnational\s+3\b/i,
];

export function isExcludedCompetition(name: string): boolean {
  return EXCLUDED_PATTERNS.some((p) => p.test(name));
}

export function isLowTierCompetition(name: string): boolean {
  return LOW_TIER_PATTERNS.some((p) => p.test(name));
}

export interface CoverageTarget {
  leagueExternalId: string;
  name: string;
  /** How many fixtures this competition has coming up in the window. */
  upcoming: number;
}

/**
 * Cover the busiest serious competitions first.
 *
 * A league with twenty fixtures this week is twenty fixtures a reader could
 * open; one with a single cup tie is one. Within the same fixture count, a
 * third-tier competition goes last.
 */
export function compareCoverage(a: CoverageTarget, b: CoverageTarget): number {
  const lowA = isLowTierCompetition(a.name) ? 1 : 0;
  const lowB = isLowTierCompetition(b.name) ? 1 : 0;
  if (lowA !== lowB) return lowA - lowB;
  if (b.upcoming !== a.upcoming) return b.upcoming - a.upcoming;
  return a.name.localeCompare(b.name);
}

/** Extra names a deployment wants kept out, from COMPETITION_EXCLUDE. */
export function extraExclusions(): RegExp[] {
  return (process.env.COMPETITION_EXCLUDE ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
}

/** The one call the ingest makes: is this competition one we hold at all? */
export function isWantedCompetition(name: string): boolean {
  if (isExcludedCompetition(name)) return false;
  return !extraExclusions().some((p) => p.test(name));
}
