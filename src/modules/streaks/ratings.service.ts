import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@/common/prisma/prisma.service';
import { EventStatus } from '@prisma/client';
import { leagueTiers, RatedMatch, replay } from './elo';
import { competitionKind } from './next-fixture';

/**
 * Rebuilds every team's rating from every finished match, oldest first.
 *
 * A full replay rather than an incremental update: it takes seconds, it is
 * always consistent with the results held, and a corrected score or a
 * backfilled season simply shows up in the next run.
 */
@Injectable()
export class RatingsService {
  private readonly logger = new Logger(RatingsService.name);

  /** Rows per read; the result set is a few small columns per match. */
  private readonly PAGE = 20_000;
  /** Rows per bulk write. */
  private readonly WRITE_CHUNK = 5_000;

  constructor(private readonly prisma: PrismaService) {}

  async computeAll(
    options: { onProgress?: (p: Record<string, unknown>) => void } = {},
  ): Promise<{ matches: number; teams: number; tiered: number }> {
    const matches: RatedMatch[] = [];
    let cursor: string | undefined;

    // Paged by id within kickoff order: stable, and no single huge result.
    for (;;) {
      const page = await this.prisma.event.findMany({
        where: { status: EventStatus.FINISHED },
        orderBy: [{ kickoffAt: 'asc' }, { id: 'asc' }],
        take: this.PAGE,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        select: {
          id: true,
          kickoffAt: true,
          leagueId: true,
          round: true,
          homeTeamId: true,
          awayTeamId: true,
          ftHomeScore: true,
          ftAwayScore: true,
          homeScore: true,
          awayScore: true,
          league: { select: { name: true } },
        },
      });
      for (const e of page) {
        const hg = e.ftHomeScore ?? e.homeScore;
        const ag = e.ftAwayScore ?? e.awayScore;
        if (hg == null || ag == null) continue;
        matches.push({
          id: e.id,
          kickoffAt: e.kickoffAt,
          leagueId: e.leagueId,
          isLeague: competitionKind(e.league.name, e.round) === 'LEAGUE',
          homeTeamId: e.homeTeamId,
          awayTeamId: e.awayTeamId,
          homeGoals: hg,
          awayGoals: ag,
        });
      }
      options.onProgress?.({ 'matches read': matches.length });
      if (page.length < this.PAGE) break;
      cursor = page[page.length - 1].id;
    }

    const { ratings, before } = replay(matches);
    const tiers = leagueTiers(ratings);
    options.onProgress?.({ 'matches read': matches.length, teams: ratings.size, writing: 'teams' });

    const now = new Date();
    const teamRows = [...ratings.entries()];
    for (let i = 0; i < teamRows.length; i += this.WRITE_CHUNK) {
      const chunk = teamRows.slice(i, i + this.WRITE_CHUNK);
      await this.prisma.$executeRaw`
        UPDATE teams t SET
          "rating" = v.rating,
          "ratingMatches" = v.matches,
          "ratingTier" = v.tier,
          "ratingLeagueId" = v.league,
          "ratedAt" = ${now}
        FROM (
          SELECT
            unnest(${chunk.map(([id]) => id)}::text[]) AS id,
            unnest(${chunk.map(([, r]) => r.rating)}::float8[]) AS rating,
            unnest(${chunk.map(([, r]) => r.matches)}::int[]) AS matches,
            unnest(${chunk.map(([id]) => tiers.get(id) ?? null)}::text[]) AS tier,
            unnest(${chunk.map(([, r]) => r.leagueId)}::text[]) AS league
        ) v
        WHERE t.id = v.id
      `;
    }

    // Only rows whose figures changed, so a daily rerun rewrites little.
    const eventRows = [...before.entries()];
    for (let i = 0; i < eventRows.length; i += this.WRITE_CHUNK) {
      const chunk = eventRows.slice(i, i + this.WRITE_CHUNK);
      await this.prisma.$executeRaw`
        UPDATE events e SET
          "homeRatingBefore" = v.h,
          "awayRatingBefore" = v.a
        FROM (
          SELECT
            unnest(${chunk.map(([id]) => id)}::text[]) AS id,
            unnest(${chunk.map(([, r]) => Math.round(r[0] * 10) / 10)}::float8[]) AS h,
            unnest(${chunk.map(([, r]) => Math.round(r[1] * 10) / 10)}::float8[]) AS a
        ) v
        WHERE e.id = v.id
          AND (e."homeRatingBefore" IS DISTINCT FROM v.h OR e."awayRatingBefore" IS DISTINCT FROM v.a)
      `;
      options.onProgress?.({
        'matches read': matches.length,
        teams: ratings.size,
        'matches written': Math.min(i + this.WRITE_CHUNK, eventRows.length),
      });
    }

    this.logger.log(`Ratings: ${matches.length} matches replayed, ${ratings.size} teams, ${tiers.size} tiered`);
    return { matches: matches.length, teams: ratings.size, tiered: tiers.size };
  }
}
