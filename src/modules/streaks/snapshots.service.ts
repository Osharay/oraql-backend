import { Injectable, Logger } from '@nestjs/common';
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

    const candidates = [...survivors, ...suggestive];

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
      select: { id: true, kickoffAt: true, homeTeamId: true, awayTeamId: true },
    });

    const rows: Prisma.StreakSnapshotCreateManyInput[] = [];
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
      const applicable = [
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

      // A MATCH-market candidate can arrive from both teams; keep one per market.
      const seenMatchMarkets = new Set<string>();
      for (const c of applicable) {
        if (c.selection === ObservationSelection.MATCH) {
          if (seenMatchMarkets.has(c.marketDefinitionId)) continue;
          seenMatchMarkets.add(c.marketDefinitionId);
        }

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

    // Skip candidate/event pairs already captured.
    const existing = await this.prisma.streakSnapshot.findMany({
      where: { eventId: { in: [...new Set(rows.map((r) => r.eventId))] } },
      select: { streakCandidateId: true, eventId: true },
    });
    const seen = new Set(existing.map((e) => `${e.streakCandidateId}::${e.eventId}`));
    const fresh = rows.filter((r) => !seen.has(`${r.streakCandidateId}::${r.eventId}`));

    if (fresh.length === 0) {
      return { captured: 0, displayed: 0, skippedPastCutoff, note: 'Already captured' };
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
        `displayed ${top.length}, skipped ${skippedPastCutoff} past cutoff`,
    );

    return {
      captured: fresh.length,
      displayed: top.length,
      gatedCandidates: survivors.length,
      suggestiveCandidates: suggestive.length,
      skippedPastCutoff,
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
