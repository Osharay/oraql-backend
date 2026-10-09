import { Injectable, Logger } from '@nestjs/common';
import { leagueCoverage, isHidden } from './league-coverage';
import { betKey } from './bet-key';
import { PrismaService } from '@/common/prisma/prisma.service';
import {
  EventStatus,
  ObservationResult,
  ObservationSelection,
  Prisma,
} from '@prisma/client';

/**
 * Snapshots and settlement — the feedback loop.
 *
 * A snapshot is an immutable record of what the engine believed BEFORE
 * kickoff. Without a hard cutoff, post-match information leaks into the
 * record and every hit rate the system reports becomes unfalsifiable, so a
 * snapshot that cannot be written before its cutoff is not written at all.
 */
@Injectable()
export class SnapshotsService {
  private readonly logger = new Logger(SnapshotsService.name);

  /** Information after this point is not available to a snapshot. */
  private readonly CUTOFF_MINUTES = 60;

  /** How far ahead to capture. */
  private readonly WINDOW_HOURS = 48;

  /** How many snapshots per day are actually surfaced to users. */
  private readonly DISPLAY_LIMIT = 10;

  /** A suggestive slice must at least clear these, or it is noise. */
  private readonly SUGGESTIVE_MIN_LIFT = 0.08;
  private readonly SUGGESTIVE_MIN_SAMPLE = 30;
  private readonly SUGGESTIVE_LIMIT = 200;

  constructor(private readonly prisma: PrismaService) {}

  /** Leagues whose results we cannot settle, read fresh (for Engine controls). */
  leagueCoverage() {
    return leagueCoverage(this.prisma, true);
  }

  /**
   * Capture snapshots for upcoming events from the latest engine run.
   *
   * A candidate applies to an event only when the team is on the side the
   * candidate was measured on: a home-form slice says nothing about that team
   * playing away.
   */
  async captureForUpcoming(options?: {
    windowHours?: number;
    cutoffMinutes?: number;
    displayLimit?: number;
    includeSuggestive?: boolean;
  }) {
    const windowHours = options?.windowHours ?? this.WINDOW_HOURS;
    const cutoffMinutes = options?.cutoffMinutes ?? this.CUTOFF_MINUTES;
    const displayLimit = options?.displayLimit ?? this.DISPLAY_LIMIT;
    const includeSuggestive = options?.includeSuggestive ?? true;

    const run = await this.prisma.engineRun.findFirst({
      where: { completedAt: { not: null } },
      orderBy: { startedAt: 'desc' },
      select: { id: true },
    });

    if (!run) {
      return { captured: 0, displayed: 0, skippedPastCutoff: 0, note: 'No completed engine run' };
    }

    const select = {
      id: true,
      entityId: true,
      marketDefinitionId: true,
      selection: true,
      hitRate: true,
      baselineRate: true,
      lift: true,
      sampleSize: true,
      currentStreak: true,
      strengthScore: true,
      survivedGate: true,
    };

    const survivors = await this.prisma.streakCandidate.findMany({
      where: { engineRunId: run.id, survivedGate: true },
      select,
    });

    // Slices that beat their baseline by a clear margin on a real sample but
    // did not clear the multiple-comparison gate. They are captured so the
    // Clusters page has something on a day nothing survives — and, more to
    // the point, so their record is settled and measured exactly like the
    // survivors'. If suggestive picks do not beat their baselines over a few
    // hundred settled snapshots, that shows, and it should.
    const suggestive = includeSuggestive
      ? await this.prisma.streakCandidate.findMany({
          where: {
            engineRunId: run.id,
            survivedGate: false,
            lift: { gte: this.SUGGESTIVE_MIN_LIFT },
            sampleSize: { gte: this.SUGGESTIVE_MIN_SAMPLE },
          },
          orderBy: { lift: 'desc' },
          take: this.SUGGESTIVE_LIMIT,
          select,
        })
      : [];

    // Recent-form runs that two seasons do not show. Captured so they are
    // settled and measured too — that is how they earn trust or lose it.
    const emerging = includeSuggestive
      ? await this.prisma.streakCandidate.findMany({
          where: {
            engineRunId: run.id,
            survivedGate: false,
            context: { path: ['emerging'], equals: true },
          },
          take: this.SUGGESTIVE_LIMIT,
          select,
        })
      : [];
    const already = new Set([...survivors, ...suggestive].map((c) => c.id));

    const candidates = [...survivors, ...suggestive, ...emerging.filter((c) => !already.has(c.id))];

    if (candidates.length === 0) {
      return {
        captured: 0,
        displayed: 0,
        skippedPastCutoff: 0,
        note: 'No candidates survived the gate, and none were close enough to capture as suggestive',
      };
    }

    const byTeam = new Map<string, typeof candidates>();
    for (const c of candidates) {
      const list = byTeam.get(c.entityId) ?? [];
      list.push(c);
      byTeam.set(c.entityId, list);
    }

    const now = new Date();
    const events = await this.prisma.event.findMany({
      where: {
        kickoffAt: { gt: now, lte: new Date(now.getTime() + windowHours * 3600_000) },
        status: { in: [EventStatus.SCHEDULED, EventStatus.LINEUP_CONFIRMED] },
      },
      select: { id: true, kickoffAt: true, homeTeamId: true, awayTeamId: true, leagueId: true },
    });

    // Leagues (or their corner and card markets) whose results we cannot
    // check: a pick there could never be judged, so none is captured.
    const coverage = await leagueCoverage(this.prisma);
    const definitionIds = await this.prisma.marketDefinition.findMany({ select: { id: true, marketId: true } });
    const marketIdOf = new Map(definitionIds.map((d) => [d.id, d.marketId]));
    let skippedUnsettleable = 0;

    const rows: Prisma.StreakSnapshotCreateManyInput[] = [];
    const rowKeys: string[] = [];
    let skippedPastCutoff = 0;

    for (const event of events) {
      const dataCutoffAt = new Date(event.kickoffAt.getTime() - cutoffMinutes * 60_000);

      // The whole point of the cutoff: if we are already past it, a snapshot
      // would be contaminated by information a user could not have had.
      if (now > dataCutoffAt) {
        skippedPastCutoff++;
        continue;
      }

      // A candidate applies only where its evidence applies:
      //   HOME/AWAY  — measured at that venue, so only that side
      //   MATCH      — fixture-level, either side (deduped below)
      //   null       — venue-agnostic team slice, whichever side the team is on
      const listed = [
        ...(byTeam.get(event.homeTeamId) ?? []).filter(
          (c) =>
            c.selection === null ||
            c.selection === ObservationSelection.HOME ||
            c.selection === ObservationSelection.MATCH,
        ),
        ...(byTeam.get(event.awayTeamId) ?? []).filter(
          (c) => c.selection === null || c.selection === ObservationSelection.AWAY,
        ),
      ];
      const applicable = listed.filter((c) => !isHidden(coverage, event.leagueId, marketIdOf.get(c.marketDefinitionId) ?? ''));
      skippedUnsettleable += listed.length - applicable.length;

      // A MATCH-market candidate can arrive from both teams; keep one per market.
      const seenMatchMarkets = new Set<string>();
      for (const c of applicable) {
        if (c.selection === ObservationSelection.MATCH) {
          if (seenMatchMarkets.has(c.marketDefinitionId)) continue;
          seenMatchMarkets.add(c.marketDefinitionId);
        }

        rowKeys.push(betKey({ eventId: event.id, marketDefinitionId: c.marketDefinitionId, selection: c.selection, entityId: c.entityId }));
        rows.push({
          streakCandidateId: c.id,
          eventId: event.id,
          dataCutoffAt,
          kickoffAt: event.kickoffAt,
          hitRate: c.hitRate,
          baselineRate: c.baselineRate,
          lift: c.lift,
          sampleSize: c.sampleSize,
          currentStreak: c.currentStreak,
          strengthScore: c.strengthScore,
        });
      }
    }

    if (rows.length === 0) {
      return { captured: 0, displayed: 0, skippedPastCutoff, note: 'Nothing to capture' };
    }

    // One snapshot per bet on a match. A bet captured by an earlier run (each
    // run has its own candidate rows) or from the other team's side of a
    // fixture market is not captured again. Before its cutoff it is brought
    // up to date with the latest run instead — otherwise it keeps the evidence
    // and the chance of the run that first found it (a raw 97% from before the
    // honest chances, say) right up to kickoff. After the cutoff it is never
    // touched: that is the record.
    const existing = await this.prisma.streakSnapshot.findMany({
      where: { eventId: { in: [...new Set(rows.map((r) => r.eventId))] } },
      select: {
        id: true,
        eventId: true,
        dataCutoffAt: true,
        streakCandidateId: true,
        streakCandidate: { select: { marketDefinitionId: true, selection: true, entityId: true } },
      },
    });
    const byKey = new Map(existing.map((e) => [betKey({ eventId: e.eventId, ...e.streakCandidate }), e]));
    const seen = new Set<string>();
    const fresh: Prisma.StreakSnapshotCreateManyInput[] = [];
    let refreshed = 0;
    for (let i = 0; i < rows.length; i++) {
      const key = rowKeys[i];
      if (seen.has(key)) continue;
      seen.add(key);
      const old = byKey.get(key);
      if (!old) {
        fresh.push(rows[i]);
        continue;
      }
      if (old.dataCutoffAt > now && old.streakCandidateId !== rows[i].streakCandidateId) {
        const r = rows[i];
        await this.prisma.streakSnapshot.update({
          where: { id: old.id },
          data: {
            streakCandidateId: r.streakCandidateId,
            capturedAt: now,
            hitRate: r.hitRate,
            baselineRate: r.baselineRate,
            lift: r.lift,
            sampleSize: r.sampleSize,
            currentStreak: r.currentStreak,
            strengthScore: r.strengthScore,
          },
        });
        refreshed++;
      }
    }

    if (fresh.length === 0) {
      return { captured: 0, refreshed, displayed: 0, skippedPastCutoff, note: refreshed ? 'Brought up to date' : 'Already captured' };
    }

    await this.prisma.streakSnapshot.createMany({ data: fresh });

    // Mark the strongest as displayed — the feed is deliberately short, and
    // only what was actually shown should be judged later.
    // Only gated survivors are ever "displayed". The daily performance
    // report reads displayed snapshots, so suggestive picks can never flatter
    // the headline record.
    const top = await this.prisma.streakSnapshot.findMany({
      where: {
        kickoffAt: { gt: now },
        wasDisplayed: false,
        streakCandidate: { survivedGate: true },
      },
      orderBy: { strengthScore: 'desc' },
      take: displayLimit,
      select: { id: true },
    });

    await Promise.all(
      top.map((s, i) =>
        this.prisma.streakSnapshot.update({
          where: { id: s.id },
          data: { wasDisplayed: true, displayedRank: i + 1 },
        }),
      ),
    );

    this.logger.log(
      `Captured ${fresh.length} snapshots (${survivors.length} gated, ${suggestive.length} suggestive candidates), ` +
        `displayed ${top.length}, skipped ${skippedPastCutoff} past cutoff, ${skippedUnsettleable} in leagues we cannot settle`,
    );

    return {
      captured: fresh.length,
      displayed: top.length,
      gatedCandidates: survivors.length,
      suggestiveCandidates: suggestive.length,
      skippedPastCutoff,
      skippedUnsettleable,
      refreshed,
      note: 'ok',
    };
  }

  /**
   * Settle snapshots whose events have finished, against the observation
   * derived for that exact event, market and selection.
   *
   * A snapshot with no matching observation stays unsettled rather than being
   * recorded as a loss — missing data is not evidence of failure.
   */
  async settleFinished(limit = 500) {
    const pending = await this.prisma.streakSnapshot.findMany({
      where: {
        result: null,
        event: { status: EventStatus.FINISHED },
      },
      select: {
        id: true,
        eventId: true,
        baselineRate: true,
        currentStreak: true,
        event: { select: { homeTeamId: true } },
        streakCandidate: {
          select: { marketDefinitionId: true, selection: true, entityId: true },
        },
      },
      take: limit,
    });

    let settled = 0;
    let unmatched = 0;

    for (const s of pending) {
      // Venue-agnostic candidates carry no selection, so the side is resolved
      // here from the fixture — the same resolution used when capturing.
      const selection =
        s.streakCandidate.selection ??
        (s.event.homeTeamId === s.streakCandidate.entityId
          ? ObservationSelection.HOME
          : ObservationSelection.AWAY);

      const observation = await this.prisma.marketObservation.findFirst({
        where: {
          eventId: s.eventId,
          marketDefinitionId: s.streakCandidate.marketDefinitionId,
          selection,
        },
        orderBy: { revision: 'desc' },
        select: { result: true },
      });

      if (!observation || observation.result === ObservationResult.UNKNOWN) {
        unmatched++;
        continue;
      }

      const isWin = observation.result === ObservationResult.WIN;
      const isVoid = observation.result === ObservationResult.VOID;

      await this.prisma.snapshotResult.create({
        data: {
          snapshotId: s.id,
          result: observation.result,
          // Realised lift compares what happened against what the market
          // normally does — the only honest scoreboard for a streak engine.
          realisedLift: isVoid ? null : (isWin ? 1 : 0) - s.baselineRate,
          brokeStreakAtLength: !isWin && !isVoid ? s.currentStreak : null,
        },
      });

      settled++;
    }

    this.logger.log(`Settled ${settled} snapshots, ${unmatched} awaiting observations`);
    return { settled, unmatched };
  }
}
