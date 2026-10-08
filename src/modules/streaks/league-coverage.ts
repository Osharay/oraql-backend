import { Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { engineSettings } from './engine-settings';
import { MARKET_DEFINITIONS } from './market-definitions';

/**
 * Leagues whose results we cannot check.
 *
 * A pick nobody can settle cannot be judged, so it should not be shown. For
 * each league, over the last N days: the share of finished matches whose goal
 * and result markets settled win or loss, and the same for corners and for
 * cards (those statistics arrive for fewer leagues). Under the bar (80%), the
 * league — or just its corner or card markets — is left out. It comes back by
 * itself once its data has been good for the same span.
 *
 * Never hides anything on an error or with too few matches to judge.
 */

export type CoverageGroup = 'MAIN' | 'CORNERS' | 'CARDS';
export const MIN_MATCHES_TO_JUDGE = 5;

export interface CoverageRow {
  leagueId: string;
  league: string;
  country: string | null;
  group: CoverageGroup;
  finished: number;
  settled: number;
}

export interface Coverage {
  /** Leagues left out entirely. */
  hiddenLeagues: Set<string>;
  /** Leagues whose corner or card markets are left out. */
  hiddenGroups: Map<string, Set<CoverageGroup>>;
  rows: Array<CoverageRow & { share: number; hidden: boolean }>;
}

export const EMPTY_COVERAGE: Coverage = { hiddenLeagues: new Set(), hiddenGroups: new Map(), rows: [] };

/** Which group a market is judged in: corners, cards, or everything else. */
export function coverageGroupOf(marketId: string): CoverageGroup {
  const cat = MARKET_DEFINITIONS.find((d) => d.marketId === marketId)?.category;
  if (String(cat) === 'CORNERS') return 'CORNERS';
  if (String(cat) === 'CARDS') return 'CARDS';
  return 'MAIN';
}

/** The verdict from per-league counts. Pure, for testing. */
export function coverageFrom(rows: CoverageRow[], minShare: number, minMatches = MIN_MATCHES_TO_JUDGE): Coverage {
  const out: Coverage = { hiddenLeagues: new Set(), hiddenGroups: new Map(), rows: [] };
  for (const r of rows) {
    const share = r.finished > 0 ? r.settled / r.finished : 1;
    const hidden = r.finished >= minMatches && share < minShare;
    out.rows.push({ ...r, share, hidden });
    if (!hidden) continue;
    if (r.group === 'MAIN') out.hiddenLeagues.add(r.leagueId);
    else out.hiddenGroups.set(r.leagueId, new Set([...(out.hiddenGroups.get(r.leagueId) ?? []), r.group]));
  }
  out.rows.sort((a, b) => Number(b.hidden) - Number(a.hidden) || a.share - b.share);
  return out;
}

/** Whether a market in a league is left out. */
export function isHidden(c: Coverage, leagueId: string | null | undefined, marketId: string): boolean {
  if (!leagueId) return false;
  if (c.hiddenLeagues.has(leagueId)) return true;
  const g = coverageGroupOf(marketId);
  return g !== 'MAIN' && (c.hiddenGroups.get(leagueId)?.has(g) ?? false);
}

const logger = new Logger('LeagueCoverage');
let cache: { at: number; value: Coverage } | null = null;
const CACHE_MS = 60 * 60 * 1000;

/** Read with a one-hour cache. Off, or on an error: nothing hidden. */
export async function leagueCoverage(
  prisma: { $queryRaw: <T>(q: Prisma.Sql) => Promise<T> },
  fresh = false,
): Promise<Coverage> {
  const s = engineSettings();
  if (!s.hideUnsettleable) return EMPTY_COVERAGE;
  if (!fresh && cache && Date.now() - cache.at < CACHE_MS) return cache.value;
  try {
    const since = new Date(Date.now() - s.leagueSettleDays * 86_400_000);
    // Matches from the last day may not be settled yet; they are not judged.
    const until = new Date(Date.now() - 86_400_000);
    const rows = await prisma.$queryRaw<
      Array<{ leagueId: string; league: string; country: string | null; grp: string; finished: bigint; settled: bigint }>
    >(Prisma.sql`
      WITH finished AS (
        SELECT e.id, e."leagueId" FROM "events" e
        WHERE e.status = 'FINISHED' AND e."kickoffAt" >= ${since} AND e."kickoffAt" < ${until}
      ),
      groups AS (
        SELECT unnest(ARRAY['MAIN', 'CORNERS', 'CARDS']) AS grp
      ),
      settled AS (
        SELECT o."eventId",
               CASE d.category::text WHEN 'CORNERS' THEN 'CORNERS' WHEN 'CARDS' THEN 'CARDS' ELSE 'MAIN' END AS grp
        FROM "market_observations" o
        JOIN "market_definitions" d ON d.id = o."marketDefinitionId"
        WHERE o.result IN ('WIN', 'LOSS') AND o."kickoffAt" >= ${since}
        GROUP BY 1, 2
      )
      SELECT f."leagueId", l.name AS league, l.country, g.grp,
             COUNT(*) AS finished,
             COUNT(s."eventId") AS settled
      FROM finished f
      CROSS JOIN groups g
      JOIN "leagues" l ON l.id = f."leagueId"
      LEFT JOIN settled s ON s."eventId" = f.id AND s.grp = g.grp
      GROUP BY f."leagueId", l.name, l.country, g.grp
    `);
    const value = coverageFrom(
      rows.map((r) => ({
        leagueId: r.leagueId,
        league: r.league,
        country: r.country,
        group: r.grp as CoverageGroup,
        finished: Number(r.finished),
        settled: Number(r.settled),
      })),
      s.leagueMinSettled,
    );
    cache = { at: Date.now(), value };
    return value;
  } catch (error) {
    logger.warn(`League coverage unavailable, nothing hidden: ${error instanceof Error ? error.message : error}`);
    return EMPTY_COVERAGE;
  }
}

/** For tests. */
export function resetLeagueCoverageCache() {
  cache = null;
}
