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
import { nextRevision } from './observation-revision';

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
      htHomeGoals: event.htHomeScore ?? null,
      htAwayGoals: event.htAwayScore ?? null,
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

    // What is already recorded for this event, latest revision per market and
    // side. A market that was UNKNOWN because an input was missing — a
    // half-time score for a match ingested before those were kept, corner
    // stats fetched later — gets a new revision once the input arrives.
    // Settled results are never revised here: readers count WIN/LOSS only and
    // ignore the revision number, so upgrading from UNKNOWN is the one change
    // that cannot double-count.
    const existing = await this.prisma.marketObservation.findMany({
      where: { eventId: event.id },
      select: { marketDefinitionId: true, selection: true, result: true, revision: true },
    });
    const latest = new Map<string, { result: string; revision: number }>();
    for (const e of existing) {
      const key = `${e.marketDefinitionId}:${e.selection}`;
      const prev = latest.get(key);
      if (!prev || e.revision > prev.revision) {
        latest.set(key, { result: e.result, revision: e.revision });
      }
    }

    // Only corner and card markets depend on per-match stats; half-time
    // markets read the score and must not be marked partial for lacking them.
    const needsStats = (req: string[]) => req.some((r) => r === 'corners' || r === 'cards');

    const rows: Prisma.MarketObservationCreateManyInput[] = [];

    for (const def of MARKET_DEFINITIONS) {
      const definitionId = defIdByMarketId.get(def.marketId);
      if (!definitionId) continue;

      for (const side of def.selections) {
        const result = def.evaluate(outcome, side as Selection);

        const revision = nextRevision(latest.get(`${definitionId}:${side}`), result);
        if (revision === null) continue;

        // UNKNOWN means the inputs were not there. Recording it keeps the gap
        // visible instead of silently shrinking the sample.
        const quality =
          result === 'UNKNOWN'
            ? DataQuality.SUSPECT
            : !hasStats && needsStats(def.requires)
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
          revision,
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
   * Derive observations for finished events.
   *
   * By default only events with none yet — cheap, and what the half-hourly
   * settlement run needs. With `refresh`, also events that are incomplete:
   * missing a market added to the registry since they were derived, or
   * holding an UNKNOWN half-time result that their now-recorded half-time
   * score can settle. Without that, every match derived before the market
   * list grew would be invisible to the new markets forever.
   */
  async deriveForFinishedEvents(
    limit = 200,
    options: { refresh?: boolean } = {},
  ): Promise<{ events: number; observations: number; refreshed: number }> {
    const { ids, refreshed } = await this.selectBatch(limit, options.refresh ?? false, []);

    let observations = 0;
    for (const id of ids) {
      observations += await this.deriveForEvent(id);
    }

    this.logger.log(
      `Derived ${observations} observations across ${ids.length} finished events` +
        (refreshed ? ` (${refreshed} topped up with new or now-settleable markets)` : ''),
    );
    return { events: ids.length, observations, refreshed };
  }

  /**
   * Derive every finished event that needs it, batch after batch, until none
   * is left — so one click after a backfill covers all of it instead of one
   * batch of 500 per click.
   *
   * An event that is still incomplete after deriving (a market that cannot
   * settle, say) is not picked up again in the same run, so the loop always
   * ends. `maxEvents` bounds a single run; anything past it waits for the next.
   */
  async deriveAll(
    options: {
      batch?: number;
      maxEvents?: number;
      onProgress?: (p: { events: number; observations: number; refreshed: number; batches: number }) => void;
    } = {},
  ): Promise<{ events: number; observations: number; refreshed: number; batches: number; complete: boolean }> {
    const batch = Math.max(1, Math.min(options.batch ?? 500, 2000));
    const maxEvents = Math.max(batch, Math.min(options.maxEvents ?? 15000, 15000));
    const seen: string[] = [];
    const totals = { events: 0, observations: 0, refreshed: 0, batches: 0 };
    let complete = false;

    while (totals.events < maxEvents) {
      const { ids, refreshed } = await this.selectBatch(
        Math.min(batch, maxEvents - totals.events),
        true,
        seen,
      );
      if (ids.length === 0) {
        complete = true;
        break;
      }

      for (const id of ids) {
        totals.observations += await this.deriveForEvent(id);
      }
      seen.push(...ids);
      totals.events += ids.length;
      totals.refreshed += refreshed;
      totals.batches += 1;
      options.onProgress?.({ ...totals });
      this.logger.log(
        `Derive batch ${totals.batches}: ${ids.length} events (${totals.events} so far, ${totals.observations} observations)`,
      );
    }

    this.logger.log(
      `Derived ${totals.observations} observations across ${totals.events} finished events in ${totals.batches} batches` +
        (complete ? '' : ` — stopped at the ${maxEvents}-event cap; run again for the rest`),
    );
    return { ...totals, complete };
  }

  /** Events with no observations first, then (optionally) incomplete ones. */
  private async selectBatch(
    limit: number,
    refresh: boolean,
    exclude: string[],
  ): Promise<{ ids: string[]; refreshed: number }> {
    const fresh = await this.prisma.event.findMany({
      where: {
        status: EventStatus.FINISHED,
        observations: { none: {} },
        ...(exclude.length ? { id: { notIn: exclude } } : {}),
      },
      select: { id: true },
      orderBy: { kickoffAt: 'desc' },
      take: limit,
    });

    let ids = fresh.map((e) => e.id);
    let refreshed = 0;

    if (refresh && ids.length < limit) {
      const stale = await this.findIncompleteEvents(limit - ids.length, exclude.concat(ids));
      refreshed = stale.length;
      ids = ids.concat(stale);
    }

    return { ids, refreshed };
  }

  /**
   * Finished events whose observations are not complete.
   *
   * A fully derived event has one row per active market and side (UNKNOWN
   * included), so fewer distinct pairs means a market is missing. An event
   * with a half-time score and an UNKNOWN on a half-time market, with no later
   * revision, can now be settled.
   */
  private async findIncompleteEvents(limit: number, exclude: string[]): Promise<string[]> {
    if (limit <= 0) return [];

    const definitions = await this.prisma.marketDefinition.findMany({
      where: { isActive: true },
      select: { marketId: true },
    });
    const active = new Set(definitions.map((d) => d.marketId));
    const expected = MARKET_DEFINITIONS.filter((d) => active.has(d.marketId)).reduce(
      (n, d) => n + d.selections.length,
      0,
    );
    if (expected === 0) return [];

    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT e.id
      FROM events e
      WHERE e.status = 'FINISHED'
        AND (
          (SELECT COUNT(*) FROM (
             SELECT DISTINCT o."marketDefinitionId", o.selection
             FROM market_observations o
             WHERE o."eventId" = e.id
           ) pairs) < ${expected}
          OR (
            e."htHomeScore" IS NOT NULL
            AND EXISTS (
              SELECT 1
              FROM market_observations o
              JOIN market_definitions d ON d.id = o."marketDefinitionId"
              WHERE o."eventId" = e.id
                AND o.result = 'UNKNOWN'
                AND 'halftime' = ANY(d.requires)
                AND NOT EXISTS (
                  SELECT 1 FROM market_observations o2
                  WHERE o2."eventId" = o."eventId"
                    AND o2."marketDefinitionId" = o."marketDefinitionId"
                    AND o2.selection = o.selection
                    AND o2.revision > o.revision
                )
            )
          )
        )
      ORDER BY e."kickoffAt" DESC
      LIMIT ${limit + exclude.length}
    `;

    const skip = new Set(exclude);
    return rows
      .map((r) => r.id)
      .filter((id) => !skip.has(id))
      .slice(0, limit);
  }

}
