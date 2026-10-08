import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { EventStatus, ObservationResult, ObservationSelection } from '@prisma/client';
import { PrismaService } from '@/common/prisma/prisma.service';
import { isInternationalCompetition } from '@/common/international';
import { BuilderService } from '@/modules/builder/builder.service';
import { settlePick } from '@/modules/picks/pick-settlement';
import { clusterOutcome, hitRate } from '@/modules/results/results-summary';
import { canDelete, cannotSave, clusterState, sourceLabel } from './custom-cluster-rules';

/**
 * Custom clusters: selections a user gathers in the Bet Builder — from the
 * Streaks tab, OraQL's clusters or a match page — and saves, to see how they
 * would have gone without placing them.
 *
 * Saving copies the selections and locks them: the record is only worth
 * something if it was made before kickoff and not touched afterwards.
 */
@Injectable()
export class CustomClustersService {
  private readonly logger = new Logger(CustomClustersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly builder: BuilderService,
  ) {}

  /** Save the user's current Bet Builder as a cluster. */
  async save(userId: string, name?: string | null) {
    const { selections, combinedProbability, combinedRange } = await this.builder.getSelections(userId);
    const now = new Date();
    const reason = cannotSave(
      selections.map((s) => ({
        label: `${s.market.event.homeTeam.name} v ${s.market.event.awayTeam.name}`,
        status: String(s.market.event.status),
        kickoffAt: s.market.event.kickoffAt,
      })),
      now,
    );
    if (reason) throw new BadRequestException(reason);

    const kicks = selections.map((s) => s.market.event.kickoffAt.getTime());
    const cluster = await this.prisma.customCluster.create({
      data: {
        userId,
        name: name?.trim().slice(0, 80) || null,
        legCount: selections.length,
        combinedProbability,
        combinedLow: combinedRange.low,
        combinedHigh: combinedRange.high,
        firstKickoffAt: new Date(Math.min(...kicks)),
        lastKickoffAt: new Date(Math.max(...kicks)),
        legs: {
          create: selections.map((s, rank) => ({
            eventId: s.market.event.id,
            rank: rank + 1,
            marketName: s.market.name,
            category: String(s.market.category),
            origin: s.market.origin,
            source: s.source,
            streakMarketId: s.streakMarketId,
            streakSide: s.streakSide,
            probability: s.market.probability,
            kickoffAt: s.market.event.kickoffAt,
          })),
        },
      },
      select: { id: true, legCount: true },
    });
    return cluster;
  }

  /** The user's saved clusters, newest first, with how each is going. */
  async list(userId: string) {
    const now = new Date();
    const rows = await this.prisma.customCluster.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 500,
      select: {
        id: true,
        name: true,
        createdAt: true,
        combinedProbability: true,
        combinedLow: true,
        combinedHigh: true,
        firstKickoffAt: true,
        legs: {
          orderBy: { rank: 'asc' },
          select: {
            marketName: true,
            origin: true,
            source: true,
            probability: true,
            kickoffAt: true,
            result: true,
            event: {
              select: {
                id: true,
                kickoffAt: true,
                status: true,
                ftHomeScore: true,
                ftAwayScore: true,
                homeScore: true,
                awayScore: true,
                homeTeam: { select: { name: true } },
                awayTeam: { select: { name: true } },
                league: { select: { name: true, country: true } },
              },
            },
          },
        },
      },
    });

    const clusters = rows.map((c) => {
      const legs = c.legs.map((l) => {
        const e = l.event;
        const h = e.ftHomeScore ?? e.homeScore;
        const a = e.ftAwayScore ?? e.awayScore;
        return {
          match: {
            eventId: e.id,
            kickoffAt: e.kickoffAt,
            status: String(e.status),
            home: e.homeTeam.name,
            away: e.awayTeam.name,
            score: h != null && a != null && e.status !== EventStatus.SCHEDULED ? `${h}–${a}` : null,
            league: e.league.name,
            country: e.league.country,
            international: isInternationalCompetition(e.league.name, e.league.country),
          },
          label: l.marketName,
          from: sourceLabel(l.source, l.origin),
          probability: l.probability,
          result: l.result ? String(l.result) : null,
        };
      });
      const state = clusterState(
        c.legs.map((l) => ({ result: l.result ? String(l.result) : null, kickoffAt: l.kickoffAt })),
        now,
      );
      return {
        id: c.id,
        name: c.name,
        createdAt: c.createdAt,
        state,
        outcome: state === 'SETTLED' ? clusterOutcome(legs.map((l) => l.result)) : 'PENDING',
        combinedProbability: c.combinedProbability,
        combinedRange: { low: c.combinedLow, high: c.combinedHigh },
        canDelete: canDelete(c.firstKickoffAt, now),
        legs,
      };
    });

    const decided = clusters.filter((c) => c.outcome === 'WIN' || c.outcome === 'LOSS');
    return {
      summary: {
        clusters: hitRate(
          decided.map((c) => ({ result: c.outcome, probability: c.combinedProbability ?? c.combinedRange.low })),
        ),
        selections: hitRate(
          clusters.flatMap((c) => c.legs.map((l) => ({ result: l.result ?? 'UNKNOWN', probability: l.probability }))),
        ),
        waiting: clusters.filter((c) => c.state !== 'SETTLED').length,
      },
      clusters,
    };
  }

  /** Delete a saved cluster — only before its first match starts. */
  async remove(userId: string, id: string) {
    const c = await this.prisma.customCluster.findFirst({ where: { id, userId }, select: { firstKickoffAt: true } });
    if (!c) throw new NotFoundException('That cluster is not in your saved clusters');
    if (!canDelete(c.firstKickoffAt, new Date()))
      throw new BadRequestException('A saved cluster stays on your record once its first match has started.');
    await this.prisma.customCluster.delete({ where: { id } });
    return { removed: id };
  }

  @Cron('20,50 * * * *')
  async scheduledSettlement() {
    try {
      await this.settleFinished();
    } catch (error) {
      this.logger.error(`Custom cluster settlement failed: ${error instanceof Error ? error.message : error}`);
    }
  }

  /**
   * Settle selections whose matches have finished: by the market's name where
   * the model names it, otherwise from the streak's own observation. A match
   * called off, or a selection that cannot be settled after three days, is void.
   */
  async settleFinished() {
    const now = Date.now();
    const legs = await this.prisma.customClusterLeg.findMany({
      where: {
        result: null,
        kickoffAt: { lt: new Date(now) },
        event: { status: { in: [EventStatus.FINISHED, EventStatus.CANCELLED, EventStatus.POSTPONED] } },
      },
      select: {
        id: true,
        eventId: true,
        marketName: true,
        streakMarketId: true,
        streakSide: true,
        kickoffAt: true,
        event: {
          select: {
            status: true,
            kickoffAt: true,
            homeTeamId: true,
            awayTeamId: true,
            ftHomeScore: true,
            ftAwayScore: true,
            homeScore: true,
            awayScore: true,
            homeTeam: { select: { name: true, shortName: true } },
            awayTeam: { select: { name: true, shortName: true } },
            matchStats: { select: { teamId: true, corners: true, yellowCards: true, redCards: true } },
          },
        },
      },
      take: 2000,
    });

    const definitions = new Map<string, string>();
    let settled = 0;
    for (const l of legs) {
      const e = l.event;
      const stale = now - l.kickoffAt.getTime() > 3 * 86_400_000;
      let result: ObservationResult | null = null;

      if (e.status !== EventStatus.FINISHED) {
        // Postponed matches usually come back with a new date on the same
        // fixture; wait for that before calling the selection void.
        if (e.status === EventStatus.CANCELLED || stale) result = ObservationResult.VOID;
      } else {
        const home = e.matchStats.find((m) => m.teamId === e.homeTeamId);
        const away = e.matchStats.find((m) => m.teamId === e.awayTeamId);
        const byName = settlePick(
          l.marketName,
          {
            homeGoals: e.ftHomeScore ?? e.homeScore,
            awayGoals: e.ftAwayScore ?? e.awayScore,
            homeCorners: home?.corners ?? null,
            awayCorners: away?.corners ?? null,
            homeCards: home ? home.yellowCards + home.redCards : null,
            awayCards: away ? away.yellowCards + away.redCards : null,
          },
          { home: e.homeTeam.shortName || e.homeTeam.name, away: e.awayTeam.shortName || e.awayTeam.name },
        );
        if (byName !== 'UNKNOWN') result = byName as ObservationResult;
        else if (l.streakMarketId && l.streakSide) {
          if (!definitions.has(l.streakMarketId)) {
            const d = await this.prisma.marketDefinition.findUnique({
              where: { marketId: l.streakMarketId },
              select: { id: true },
            });
            if (d) definitions.set(l.streakMarketId, d.id);
          }
          const defId = definitions.get(l.streakMarketId);
          const obs = defId
            ? await this.prisma.marketObservation.findFirst({
                where: { eventId: l.eventId, marketDefinitionId: defId, selection: l.streakSide as ObservationSelection },
                orderBy: { revision: 'desc' },
                select: { result: true },
              })
            : null;
          if (obs && obs.result !== ObservationResult.UNKNOWN) result = obs.result;
        }
        if (!result && stale) result = ObservationResult.VOID;
      }

      if (!result) continue;
      await this.prisma.customClusterLeg.update({ where: { id: l.id }, data: { result, settledAt: new Date() } });
      settled++;
    }

    if (settled) this.logger.log(`Custom cluster selections settled: ${settled}`);
    return { settled, waiting: legs.length - settled };
  }
}
