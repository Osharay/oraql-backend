import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@/common/prisma/prisma.service';
import { seasonStartMonth } from './season-infer';

/**
 * Puts the right season on every match and every observation.
 *
 * Observations took their season from the league row, which holds a single
 * season set when the league was first seen and never updated — so every
 * match a league ever had carried the same one. "This season" on a card then
 * counted two years, and a relegated side's two leagues were told apart by
 * accident rather than by season.
 *
 * New fixtures now store the provider's season. This fills in the rest: each
 * league's season start is read from its own calendar (season-infer.ts), the
 * missing match seasons are set from kickoff dates, and observations are
 * brought into line with their match. League by league, so no statement holds
 * locks for long. Safe to run again; the second run changes nothing.
 */
@Injectable()
export class SeasonRepairService {
  private readonly logger = new Logger(SeasonRepairService.name);

  constructor(private readonly prisma: PrismaService) {}

  async repair(
    options: { onProgress?: (p: Record<string, unknown>) => void } = {},
  ): Promise<{ leagues: number; matchesSet: number; observationsFixed: number }> {
    const monthly = await this.prisma.$queryRaw<Array<{ leagueId: string; m: number; n: number }>>`
      SELECT "leagueId", EXTRACT(MONTH FROM "kickoffAt")::int AS m, COUNT(*)::int AS n
      FROM events
      GROUP BY 1, 2
    `;

    const counts = new Map<string, number[]>();
    for (const r of monthly) {
      const arr = counts.get(r.leagueId) ?? new Array(12).fill(0);
      arr[Number(r.m) - 1] = Number(r.n);
      counts.set(r.leagueId, arr);
    }

    let matchesSet = 0;
    let observationsFixed = 0;
    let done = 0;

    for (const [leagueId, months] of counts) {
      const start = seasonStartMonth(months);

      matchesSet += await this.prisma.$executeRaw`
        UPDATE events SET season = CASE
          WHEN EXTRACT(MONTH FROM "kickoffAt") >= ${start} THEN EXTRACT(YEAR FROM "kickoffAt")::int
          ELSE EXTRACT(YEAR FROM "kickoffAt")::int - 1
        END
        WHERE "leagueId" = ${leagueId} AND season IS NULL
      `;

      observationsFixed += await this.prisma.$executeRaw`
        UPDATE market_observations o SET season = e.season
        FROM events e
        WHERE e."leagueId" = ${leagueId}
          AND o."eventId" = e.id
          AND e.season IS NOT NULL
          AND o.season <> e.season
      `;

      done++;
      options.onProgress?.({
        leagues: `${done} of ${counts.size}`,
        'matches given a season': matchesSet,
        'observations corrected': observationsFixed,
      });
    }

    this.logger.log(
      `Seasons repaired: ${counts.size} leagues, ${matchesSet} matches set, ${observationsFixed} observations corrected`,
    );
    return { leagues: counts.size, matchesSet, observationsFixed };
  }
}
