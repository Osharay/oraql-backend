import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@/common/prisma/prisma.service';
import {
  DataQuality,
  EventStatus,
  ObservationResult,
  ObservationSelection,
  Prisma,
} from '@prisma/client';
import { MARKET_DEFINITIONS, MatchOutcome, Selection } from './market-definitions';

/**
 * Turns finished matches into market observations.
 *
 * One result fans out into dozens of rows, all computed locally — this costs
 * no provider requests, which is what makes a wide market vocabulary
 * affordable. Observations are append-only; re-running is idempotent because
 * (eventId, market, selection, revision) is unique.
 */
@Injectable()
export class ObservationsService {
  private readonly logger = new Logger(ObservationsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Push the code registry into the database so other services can join
   * against it. Safe to call on every boot.
   */
  async syncRegistry() {
    for (const def of MARKET_DEFINITIONS) {
      await this.prisma.marketDefinition.upsert({
        where: { marketId: def.marketId },
        create: {
          marketId: def.marketId,
          displayName: def.displayName,
          shortName: def.shortName,
          category: def.category,
          line: def.line,
          selections: def.selections as ObservationSelection[],
          requires: def.requires,
          notes: def.notes,
        },
        update: {
          displayName: def.displayName,
          shortName: def.shortName,
          category: def.category,
          line: def.line,
          selections: def.selections as ObservationSelection[],
          requires: def.requires,
          notes: def.notes,
        },
      });
    }
    this.logger.log(`Market registry synced: ${MARKET_DEFINITIONS.length} definitions`);
    return MARKET_DEFINITIONS.length;
  }

  /**
   * Derive observations for one finished event.
   * Returns the number of rows written (0 if the event is not settled).
   */
  async deriveForEvent(eventId: string): Promise<number> {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      include: {
        league: { select: { id: true, season: true } },
        matchStats: true,
      },
    });

    if (!event) return 0;
    if (event.status !== EventStatus.FINISHED) return 0;

    const homeGoals = event.ftHomeScore ?? event.homeScore;
    const awayGoals = event.ftAwayScore ?? event.awayScore;

    // No score means nothing can be settled. Do not guess, do not record a loss.
    if (homeGoals == null || awayGoals == null) {
      this.logger.debug(`Event ${eventId} finished without a score — skipped`);
      return 0;
    }

    const homeStats = event.matchStats.find((s) => s.teamId === event.homeTeamId);
    const awayStats = event.matchStats.find((s) => s.teamId === event.awayTeamId);

    const outcome: MatchOutcome = {
      homeGoals,
      awayGoals,
      homeCorners: homeStats?.corners ?? null,
      awayCorners: awayStats?.corners ?? null,
      homeYellowCards: homeStats?.yellowCards ?? null,
      awayYellowCards: awayStats?.yellowCards ?? null,
    };

    const hasStats = Boolean(homeStats && awayStats);
    const definitions = await this.prisma.marketDefinition.findMany({
      where: { isActive: true },
      select: { id: true, marketId: true },
    });
    const defIdByMarketId = new Map(definitions.map((d) => [d.marketId, d.id]));

    const rows: Prisma.MarketObservationCreateManyInput[] = [];

    for (const def of MARKET_DEFINITIONS) {
      const definitionId = defIdByMarketId.get(def.marketId);
      if (!definitionId) continue;

      for (const side of def.selections) {
        const result = def.evaluate(outcome, side as Selection);

        // UNKNOWN means the inputs were not there. Recording it keeps the gap
        // visible instead of silently shrinking the sample.
        const quality =
          result === 'UNKNOWN'
            ? DataQuality.SUSPECT
            : !hasStats && def.requires.some((r) => r !== 'goals')
              ? DataQuality.PARTIAL
              : DataQuality.OK;

        rows.push({
          eventId: event.id,
          marketDefinitionId: definitionId,
          selection: side as ObservationSelection,
          line: def.line,
          result: result as ObservationResult,
          leagueId: event.league.id,
          season: event.league.season,
          teamId:
            side === 'HOME'
              ? event.homeTeamId
              : side === 'AWAY'
                ? event.awayTeamId
                : null,
          isHome: side === 'MATCH' ? null : side === 'HOME',
          kickoffAt: event.kickoffAt,
          dataQuality: quality,
          revision: 1,
        });
      }
    }

    const written = await this.prisma.marketObservation.createMany({
      data: rows,
      skipDuplicates: true,
    });

    return written.count;
  }

  /**
   * Derive observations for every finished event that has none yet.
   */
  async deriveForFinishedEvents(limit = 200): Promise<{ events: number; observations: number }> {
    const events = await this.prisma.event.findMany({
      where: {
        status: EventStatus.FINISHED,
        observations: { none: {} },
      },
      select: { id: true },
      orderBy: { kickoffAt: 'desc' },
      take: limit,
    });

    let observations = 0;
    for (const e of events) {
      observations += await this.deriveForEvent(e.id);
    }

    this.logger.log(
      `Derived ${observations} observations across ${events.length} finished events`,
    );
    return { events: events.length, observations };
  }
}
