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
import { deriveSignature, registryHash } from './derive-signature';
import { deriveSeasons } from '@/config/app.config';

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
   * What the observations table is holding, and how much of it is outside
   * what we now measure.
   *
   * The disk filled while coverage followed whatever fixtures arrived: U19
   * leagues, friendlies, third divisions, all derived at about 100 rows a
   * match. Those rows feed nothing now that the target list decides what the
   * product covers — but deleting is a decision for a person, so this counts
   * first and deletes only when told.
   */
  async reclaimable(): Promise<{
    totalRows: number;
    outsideTargets: number;
    outsideWindow: number;
    reclaimable: number;
    deriveSeasons: number;
    estimatedMb: number;
    targetsSeeded: boolean;
  }> {
    const since = new Date(Date.now() - deriveSeasons() * 365 * 86_400_000);
    const targets = await this.prisma.targetCompetition.findMany({
      where: { isActive: true, externalId: { not: null } },
      select: { externalId: true },
    });
    const targetIds: string[] = targets
      .map((t) => String(t.externalId))
      .filter((id: string) => !id.startsWith('unresolved:'));

    const [totalRows, outsideTargets, outsideWindow, reclaimable] = await Promise.all([
      this.prisma.marketObservation.count(),
      targetIds.length
        ? this.prisma.marketObservation.count({
            where: { event: { league: { externalId: { notIn: targetIds } } } },
          })
        : Promise.resolve(0),
      this.prisma.marketObservation.count({ where: { kickoffAt: { lt: since } } }),
      targetIds.length
        ? this.prisma.marketObservation.count({
            where: {
              OR: [
                { event: { league: { externalId: { notIn: targetIds } } } },
                { kickoffAt: { lt: since } },
              ],
            },
          })
        : this.prisma.marketObservation.count({ where: { kickoffAt: { lt: since } } }),
    ]);

    return {
      totalRows,
      outsideTargets,
      outsideWindow,
      reclaimable,
      deriveSeasons: deriveSeasons(),
      // Measured on this database: roughly 1 GB per million rows with indexes.
      estimatedMb: Math.round((reclaimable / 1_000_000) * 1024),
      targetsSeeded: targetIds.length > 0,
    };
  }

  /**
   * Delete the observations outside the target competitions or the derive
   * window. Fixtures and scores are kept, so any of it can be derived again
   * by widening the window or adding the competition back.
   */
  async reclaim(options: { batch?: number } = {}): Promise<{
    deleted: number;
    batches: number;
    remaining: number;
  }> {
    const batch = Math.max(1000, Math.min(options.batch ?? 20_000, 100_000));
    const since = new Date(Date.now() - deriveSeasons() * 365 * 86_400_000);

    const targets = await this.prisma.targetCompetition.findMany({
      where: { isActive: true, externalId: { not: null } },
      select: { externalId: true },
    });
    const targetIds: string[] = targets
      .map((t) => String(t.externalId))
      .filter((id: string) => !id.startsWith('unresolved:'));

    let deleted = 0;
    let batches = 0;

    // Deleted in batches by id: one statement over two million rows would
    // hold a long transaction and spill to the same disk we are trying to
    // free.
    for (;;) {
      const doomed = await this.prisma.marketObservation.findMany({
        where: targetIds.length
          ? {
              OR: [
                { event: { league: { externalId: { notIn: targetIds } } } },
                { kickoffAt: { lt: since } },
              ],
            }
          : { kickoffAt: { lt: since } },
        select: { id: true },
        take: batch,
      });

      if (doomed.length === 0) break;

      const result = await this.prisma.marketObservation.deleteMany({
        where: { id: { in: doomed.map((d) => String(d.id)) } },
      });
      deleted += result.count;
      batches++;
      this.logger.log(`Reclaim: ${deleted} observations deleted so far`);

      if (batches > 500) break;
    }

    const remaining = await this.prisma.marketObservation.count();
    this.logger.log(
      `Reclaim finished: ${deleted} observations deleted in ${batches} batches, ${remaining} remain`,
    );

    return { deleted, batches, remaining };
  }

  /**
   * The active market registry, read once a minute instead of once a match.
   *
   * Deriving asked the database for all 70 definitions on every single event:
   * 15,000 matches meant 15,000 identical queries. The registry changes when
   * an admin syncs it, so a minute of staleness costs nothing.
   */
  private definitionCache: {
    at: number;
    rows: Array<{ id: string; marketId: string }>;
  } | null = null;

  private async activeDefinitions(): Promise<Array<{ id: string; marketId: string }>> {
    if (this.definitionCache && Date.now() - this.definitionCache.at < 60_000) {
      return this.definitionCache.rows;
    }
    const rows = await this.prisma.marketDefinition.findMany({
      where: { isActive: true },
      select: { id: true, marketId: true },
    });
    this.definitionCache = { at: Date.now(), rows };
    return rows;
  }

  /** Fingerprint of the markets derivation will actually write: active AND known to the code. */
  private registryHashOf(definitions: Array<{ marketId: string }>): string {
    const active = new Set(definitions.map((d) => String(d.marketId)));
    return registryHash(
      MARKET_DEFINITIONS.filter((d) => active.has(d.marketId)).map((d) => d.marketId),
    );
  }

  /**
   * Record what each event was derived from, so the refresh pass can tell
   * whether it needs doing again without counting its observations. Grouped by
   * signature: a batch has a handful of distinct ones, so this is a few
   * UPDATEs, not one per event.
   */
  private async stampSignatures(signatureByEvent: Map<string, string>): Promise<void> {
    const bySignature = new Map<string, string[]>();
    for (const [eventId, signature] of signatureByEvent) {
      const ids = bySignature.get(signature) ?? [];
      ids.push(eventId);
      bySignature.set(signature, ids);
    }
    for (const [signature, ids] of bySignature) {
      await this.prisma.event.updateMany({
        where: { id: { in: ids } },
        data: { derivedSignature: signature },
      });
    }
  }

  /**
   * Derive a whole batch of matches in a handful of queries.
   *
   * The per-match path asked the database four questions for every match —
   * the event, the registry, what was already recorded, then the insert —
   * so a 15,000-match run made about 60,000 round trips and took hours. This
   * reads the batch in three queries and writes it in chunks, which is where
   * nearly all of that time was going.
   */
  async deriveBatch(eventIds: string[]): Promise<number> {
    if (eventIds.length === 0) return 0;

    const [definitions, events, existing] = await Promise.all([
      this.activeDefinitions(),
      this.prisma.event.findMany({
        where: { id: { in: eventIds } },
        include: {
          league: { select: { id: true, season: true } },
          matchStats: true,
        },
      }),
      this.prisma.marketObservation.findMany({
        where: { eventId: { in: eventIds } },
        select: {
          eventId: true,
          marketDefinitionId: true,
          selection: true,
          result: true,
          revision: true,
        },
      }),
    ]);

    const defIdByMarketId = new Map<string, string>(
      definitions.map((d) => [String(d.marketId), String(d.id)]),
    );
    const hash = this.registryHashOf(definitions);
    const signatures = new Map<string, string>();

    // eventId -> "definition:selection" -> latest recorded result
    const latestByEvent = new Map<string, Map<string, { result: string; revision: number }>>();
    for (const e of existing) {
      const key = `${e.marketDefinitionId}:${e.selection}`;
      const forEvent = latestByEvent.get(String(e.eventId)) ?? new Map();
      const prev = forEvent.get(key);
      if (!prev || Number(e.revision) > prev.revision) {
        forEvent.set(key, { result: String(e.result), revision: Number(e.revision) });
      }
      latestByEvent.set(String(e.eventId), forEvent);
    }

    const rows: Prisma.MarketObservationCreateManyInput[] = [];

    for (const event of events) {
      if (event.status !== EventStatus.FINISHED) continue;

      const homeGoals = event.ftHomeScore ?? event.homeScore;
      const awayGoals = event.ftAwayScore ?? event.awayScore;

      const homeStats = event.matchStats.find((st: any) => st.teamId === event.homeTeamId);
      const awayStats = event.matchStats.find((st: any) => st.teamId === event.awayTeamId);
      const hasStats = Boolean(homeStats && awayStats);
      const hasScore = homeGoals != null && awayGoals != null;

      // Stamped even when there is no score to settle, so the refresh pass
      // leaves a scoreless match alone until its score arrives.
      signatures.set(
        String(event.id),
        deriveSignature({
          registryHash: hash,
          hasStats,
          hasHalfTime: event.htHomeScore != null && event.htAwayScore != null,
          hasScore,
        }),
      );

      if (homeGoals == null || awayGoals == null) continue;

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

      const latest = latestByEvent.get(String(event.id)) ?? new Map();

      for (const def of MARKET_DEFINITIONS) {
        const definitionId = defIdByMarketId.get(def.marketId);
        if (!definitionId) continue;
        if (!hasStats && def.requires.some((r) => r === 'corners' || r === 'cards')) continue;

        for (const side of def.selections) {
          const result = def.evaluate(outcome, side as Selection);
          const revision = nextRevision(latest.get(`${definitionId}:${side}`), result);
          if (revision === null) continue;

          rows.push({
            eventId: event.id,
            marketDefinitionId: definitionId,
            selection: side as ObservationSelection,
            line: def.line,
            result: result as ObservationResult,
            leagueId: event.league.id,
            season: event.league.season,
            teamId:
              side === 'HOME' ? event.homeTeamId : side === 'AWAY' ? event.awayTeamId : null,
            isHome: side === 'MATCH' ? null : side === 'HOME',
            kickoffAt: event.kickoffAt,
            dataQuality: result === 'UNKNOWN' ? DataQuality.SUSPECT : DataQuality.OK,
            revision,
          });
        }
      }
    }

    // Chunked: one insert of 50,000 rows holds a long transaction and spills
    // to the same disk the volume is short of.
    let written = 0;
    const CHUNK = 5_000;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const result = await this.prisma.marketObservation.createMany({
        data: rows.slice(i, i + CHUNK),
        skipDuplicates: true,
      });
      written += result.count;
    }

    // Only after the rows are in: a crash before this leaves the event
    // unstamped, and it is simply derived again (idempotently) next pass.
    await this.stampSignatures(signatures);

    return written;
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

      // Corner and card markets need per-match statistics. When the provider
      // sends none — and on this account it sends none at all — writing an
      // UNKNOWN per market and side records a gap that can never fill: about
      // one row in ten, on every match, for good. Skip them instead, and let
      // the completeness check below expect fewer rows for such an event, so
      // it still counts as done. If statistics arrive later, the expectation
      // rises again and the event is picked back up, exactly as half-time
      // markets were once half-time scores started coming in.
      if (!hasStats && needsStats(def.requires)) continue;

      for (const side of def.selections) {
        const result = def.evaluate(outcome, side as Selection);

        const revision = nextRevision(latest.get(`${definitionId}:${side}`), result);
        if (revision === null) continue;

        // UNKNOWN means the inputs were not there. Recording it keeps the gap
        // visible instead of silently shrinking the sample.
        const quality = result === 'UNKNOWN' ? DataQuality.SUSPECT : DataQuality.OK;

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

    const observations = await this.deriveBatch(ids);

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
      onProgress?: (p: Record<string, unknown>) => void;
    } = {},
  ): Promise<{ events: number; observations: number; refreshed: number; batches: number; complete: boolean }> {
    const batch = Math.max(1, Math.min(options.batch ?? 500, 2000));
    const maxEvents = Math.max(batch, Math.min(options.maxEvents ?? 15000, 15000));
    const totals = { events: 0, observations: 0, refreshed: 0, batches: 0 };
    let complete = false;

    // Events already handled this run. Kept in memory and used to filter the
    // batch here, with only the most recent few thousand sent to the
    // database: passing every id seen meant a 7,000-element NOT IN by batch
    // fifteen, growing every batch, so the run slowed as it went.
    const seen = new Set<string>();
    const recent: string[] = [];

    // The run's size up front, so the banner can say "of N" and how long.
    const toDo = Math.min(await this.countUnderived(), maxEvents);
    const startedAt = Date.now();
    const progress = () => {
      const perEvent = totals.events > 0 ? (Date.now() - startedAt) / totals.events : 0;
      const left = Math.max(0, toDo - totals.events);
      return {
        matches: toDo > 0 ? `${totals.events} of ${toDo}` : `${totals.events}`,
        observations: totals.observations,
        batches: totals.batches,
        ...(totals.refreshed ? { 'topped up': totals.refreshed } : {}),
        ...(perEvent > 0 && left > 0
          ? { 'about minutes left': Math.max(1, Math.round((left * perEvent) / 60_000)) }
          : {}),
      };
    };
    options.onProgress?.(progress());

    while (totals.events < maxEvents) {
      const selected = await this.selectBatch(
        Math.min(batch, maxEvents - totals.events),
        true,
        recent.slice(-2_000),
      );
      const ids = selected.ids.filter((id) => !seen.has(id));
      const refreshed = selected.refreshed;

      // Nothing new left — either everything is derived, or what remains
      // cannot be completed and has already been tried this run.
      if (ids.length === 0) {
        complete = true;
        break;
      }

      totals.observations += await this.deriveBatch(ids);
      for (const id of ids) {
        seen.add(id);
        recent.push(id);
      }
      totals.events += ids.length;
      totals.refreshed += refreshed;
      totals.batches += 1;
      options.onProgress?.(progress());
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

  /** The derive window and the covered competitions' provider ids. */
  private async deriveScope(): Promise<{ since: Date; targetIds: string[] }> {
    const since = new Date(Date.now() - deriveSeasons() * 365 * 86_400_000);
    const targets = await this.prisma.targetCompetition.findMany({
      where: { isActive: true, externalId: { not: null } },
      select: { externalId: true },
    });
    const targetIds: string[] = targets
      .map((t) => String(t.externalId))
      .filter((id: string) => !id.startsWith('unresolved:'));
    return { since, targetIds };
  }

  /**
   * How many finished matches in scope have no observations yet — the size of
   * a run's main job, so its progress can say "of N" and estimate time left.
   * Matches only being topped up (new markets, late stats) come on top.
   */
  async countUnderived(): Promise<number> {
    const { since, targetIds } = await this.deriveScope();
    const rows = await this.prisma.$queryRaw<Array<{ n: bigint | number }>>`
      SELECT COUNT(*) AS n
      FROM events e
      JOIN leagues l ON l.id = e."leagueId"
      WHERE e.status = 'FINISHED'
        AND e."kickoffAt" >= ${since}
        AND (${targetIds.length} = 0 OR l."externalId" = ANY(${targetIds}::text[]))
        AND NOT EXISTS (SELECT 1 FROM market_observations o WHERE o."eventId" = e.id)
    `;
    return Number(rows[0]?.n ?? 0);
  }

  /** Events with no observations first, then (optionally) incomplete ones. */
  private async selectBatch(
    limit: number,
    refresh: boolean,
    exclude: string[],
  ): Promise<{ ids: string[]; refreshed: number }> {
    const { since, targetIds } = await this.deriveScope();

    // Raw SQL on purpose. Prisma writes `observations: { none: {} }` as
    // `id NOT IN (SELECT "eventId" FROM market_observations)`, and with over a
    // million rows that subquery no longer fits in memory as a hash, so
    // Postgres re-scans it for every candidate event: one batch took well over
    // an hour and held the database at full CPU. NOT EXISTS uses the
    // (eventId, …) unique index and answers each event with one lookup.
    const fresh = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT e.id
      FROM events e
      JOIN leagues l ON l.id = e."leagueId"
      WHERE e.status = 'FINISHED'
        AND e."kickoffAt" >= ${since}
        AND (${targetIds.length} = 0 OR l."externalId" = ANY(${targetIds}::text[]))
        AND NOT EXISTS (SELECT 1 FROM market_observations o WHERE o."eventId" = e.id)
        AND NOT (e.id = ANY(${exclude}::text[]))
      ORDER BY e."kickoffAt" DESC
      LIMIT ${limit}
    `;

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
   * Finished events whose derivation is out of date.
   *
   * An event is up to date when its stamp matches what it would be derived
   * from now: the same live markets, and the same inputs present. A market
   * added to the registry, statistics arriving for both sides, a half-time
   * score (which settles half-time UNKNOWNs) or a final score all change the
   * expected stamp, so the event comes back exactly when there is new work.
   *
   * This replaced counting each event's distinct observation pairs, which ran
   * a subquery over market_observations for every match on every batch.
   * Events never stamped (derived before stamps existed) come back once.
   */
  private async findIncompleteEvents(limit: number, exclude: string[]): Promise<string[]> {
    if (limit <= 0) return [];

    const since = new Date(Date.now() - deriveSeasons() * 365 * 86_400_000);
    const targets = await this.prisma.targetCompetition.findMany({
      where: { isActive: true, externalId: { not: null } },
      select: { externalId: true },
    });
    const targetIds: string[] = targets
      .map((t) => String(t.externalId))
      .filter((id: string) => !id.startsWith('unresolved:'));

    const definitions = await this.activeDefinitions();
    const hash = this.registryHashOf(definitions);

    // Must build the same string as deriveSignature().
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT e.id
      FROM events e
      JOIN leagues l ON l.id = e."leagueId"
      WHERE e.status = 'FINISHED'
        AND e."kickoffAt" >= ${since}
        AND (
          ${targetIds.length} = 0
          OR l."externalId" = ANY(${targetIds}::text[])
        )
        AND e."derivedSignature" IS DISTINCT FROM (
          ${hash}
          || ':' || CASE WHEN (
               SELECT COUNT(*) FROM match_stats ms
               WHERE ms."eventId" = e.id
                 AND ms."teamId" IN (e."homeTeamId", e."awayTeamId")
             ) = 2 THEN '1' ELSE '0' END
          || ':' || CASE WHEN e."htHomeScore" IS NOT NULL AND e."htAwayScore" IS NOT NULL
                    THEN '1' ELSE '0' END
          || ':' || CASE WHEN COALESCE(e."ftHomeScore", e."homeScore") IS NOT NULL
                          AND COALESCE(e."ftAwayScore", e."awayScore") IS NOT NULL
                    THEN '1' ELSE '0' END
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
