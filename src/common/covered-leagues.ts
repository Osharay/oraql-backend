import type { PrismaService } from '@/common/prisma/prisma.service';
/** Fits Prisma's LeagueWhereInput; spelled out so this file needs no generated types. */
export type CoveredLeagueFilter = { externalId: { in: string[] } };

/** Only the one read this needs, so a test double fits too. */
type TargetReader = Pick<PrismaService, 'targetCompetition'>;

let cache: { filter: CoveredLeagueFilter | undefined; at: number } | null = null;

/**
 * A league filter for the competitions OraQL covers, or undefined when the
 * target list has not been seeded yet (a fresh deployment shows everything).
 *
 * Fixtures saved before the list existed — hundreds a day from leagues with no
 * history behind them — would otherwise fill the dashboard with match pages
 * the engine can say nothing about. Cached for a minute.
 */
export async function coveredLeagueFilter(
  prisma: TargetReader,
): Promise<CoveredLeagueFilter | undefined> {
  if (cache && Date.now() - cache.at < 60_000) return cache.filter;
  const rows = await prisma.targetCompetition.findMany({
    where: { isActive: true, externalId: { not: null } },
    select: { externalId: true },
  });
  const ids = coveredIds(rows);
  const filter = ids.length ? { externalId: { in: ids } } : undefined;
  cache = { filter, at: Date.now() };
  return filter;
}

/** Resolved provider ids only; unresolved placeholders never match a league. */
export function coveredIds(rows: Array<{ externalId: string | null }>): string[] {
  return [
    ...new Set(
      rows
        .map((r) => (r.externalId == null ? '' : String(r.externalId)))
        .filter((id) => id !== '' && !id.startsWith('unresolved:')),
    ),
  ];
}

/** For tests. */
export function resetCoveredLeagueCache(): void {
  cache = null;
}
