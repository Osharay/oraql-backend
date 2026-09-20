import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@/common/prisma/prisma.service';
import { ObservationResult, StreakStatus } from '@prisma/client';
import {
  combinedProbability,
  pickDiverseComponents,
  MIN_CLUSTER_SIZE,
  type Selectable,
} from './cluster-selection';
import { marketScope } from './market-definitions';
import { streakMarketLabel, marketSubjectOf } from '@/common/market-copy';

/**
 * Cluster assembly.
 *
 * A cluster gathers several independently surviving streaks into one view. Its
 * value is the spread: unrelated events, unrelated leagues and — the part the
 * client stressed most — unrelated markets. Four variations of "over 2.5" is
 * not a cluster, it is one idea repeated, so diversity is enforced rather than
 * hoped for.
 *
 * It is a discovery and display object. Whether the user acts on it, and how,
 * is their decision; the combined probability is shown so that decision is an
 * informed one.
 */
@Injectable()
export class ClustersService {
  private readonly logger = new Logger(ClustersService.name);

  private readonly DEFAULT_SIZE = 4;
  private readonly MAX_SIZE = 8;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Build clusters for a day from snapshots already captured.
   *
   * Works from snapshots rather than candidates so a cluster inherits the
   * pre-kickoff cutoff — a cluster can never contain evidence its components
   * did not have at capture time.
   */
  async buildForDate(options?: {
    date?: string;
    size?: number;
    count?: number;
    requireDistinctLeague?: boolean;
  }) {
    const size = Math.min(options?.size ?? this.DEFAULT_SIZE, this.MAX_SIZE);
    const count = options?.count ?? 3;
    const requireDistinctLeague = options?.requireDistinctLeague ?? false;

    const day = options?.date ? new Date(options.date) : new Date();
    const start = new Date(day);
    start.setHours(0, 0, 0, 0);
    const end = new Date(day);
    end.setHours(23, 59, 59, 999);

    const snapshots = await this.prisma.streakSnapshot.findMany({
      where: { kickoffAt: { gte: start, lte: end }, result: null },
      select: {
        id: true,
        hitRate: true,
        strengthScore: true,
        eventId: true,
        event: { select: { leagueId: true } },
        streakCandidate: { select: { marketDefinitionId: true } },
      },
      orderBy: { strengthScore: 'desc' },
    });

    if (snapshots.length === 0) {
      return { created: 0, note: 'No snapshots available for this date' };
    }

    // Clear any clusters previously built for this day so a rebuild replaces
    // rather than accumulates.
    await this.prisma.cluster.deleteMany({
      where: { date: { gte: start, lte: end } },
    });

    const used = new Set<string>();
    const clusters: Selectable[][] = [];

    // Flatten to the shape the selection rules work on.
    const pool = snapshots.map((s) => ({
      id: s.id,
      eventId: s.eventId,
      leagueId: s.event.leagueId,
      marketDefinitionId: s.streakCandidate.marketDefinitionId,
      hitRate: s.hitRate,
      strengthScore: s.strengthScore,
    }));

    for (let i = 0; i < count; i++) {
      const picked = pickDiverseComponents(pool, {
        size,
        requireDistinctLeague,
        used,
      });
      if (picked.length < MIN_CLUSTER_SIZE) break;
      picked.forEach((p) => used.add(p.id));
      clusters.push(picked);
    }

    let created = 0;

    for (const components of clusters) {
      const cluster = await this.prisma.cluster.create({
        data: {
          date: start,
          type: 'DAILY_STRONGEST',
          componentCount: components.length,
          combinedProbability: combinedProbability(components),
          status: StreakStatus.NEW,
        },
      });

      await this.prisma.clusterComponent.createMany({
        data: components.map((c, rank) => ({
          clusterId: cluster.id,
          snapshotId: c.id,
          rank: rank + 1,
        })),
      });

      created++;
    }

    this.logger.log(
      `Built ${created} clusters for ${start.toISOString().slice(0, 10)} from ${snapshots.length} snapshots`,
    );

    return {
      created,
      snapshotsConsidered: snapshots.length,
      note:
        created === 0
          ? 'Not enough diverse snapshots to form a cluster — each component must come from a different event and a different market.'
          : 'Combined probability assumes independence and is an approximation.',
    };
  }


  /** Clusters for a date, with their components and results when settled. */
  async listForDate(date?: string) {
    const day = date ? new Date(date) : new Date();
    const start = new Date(day);
    start.setHours(0, 0, 0, 0);
    const end = new Date(day);
    end.setHours(23, 59, 59, 999);

    const clusters = await this.prisma.cluster.findMany({
      where: { date: { gte: start, lte: end } },
      include: {
        components: {
          orderBy: { rank: 'asc' },
          include: {
            snapshot: {
              include: {
                result: { select: { result: true } },
                event: {
                  select: {
                    kickoffAt: true,
                    homeTeam: { select: { name: true, shortName: true } },
                    awayTeam: { select: { name: true, shortName: true } },
                    league: { select: { name: true } },
                  },
                },
                streakCandidate: {
                  select: {
                    selection: true,
                    entityType: true,
                    entityId: true,
                    marketDefinition: {
                      select: { marketId: true, displayName: true, shortName: true },
                    },
                  },
                },
              },
            },
          },
        },
      },
      orderBy: { combinedProbability: 'desc' },
    });

    // Name the club each component is about. A team market read against a
    // fixture otherwise looks like it covers both sides — only one team can
    // be selected for a draw no bet, and the card has to say which.
    const teamIds = new Set<string>();
    for (const cluster of clusters) {
      for (const c of cluster.components) {
        const sc = c.snapshot.streakCandidate;
        if (sc.entityType === 'TEAM') teamIds.add(sc.entityId);
      }
    }

    const teams = teamIds.size
      ? await this.prisma.team.findMany({
          where: { id: { in: [...teamIds] } },
          select: { id: true, name: true, shortName: true },
        })
      : [];
    const teamName = new Map<string, string>(
      teams.map((t) => [t.id, String(t.shortName || t.name)]),
    );

    const decorated = clusters.map((cluster) => ({
      ...cluster,
      components: cluster.components.map((c) => {
        const sc = c.snapshot.streakCandidate;
        const scope = marketScope(sc.marketDefinition.marketId);
        const name = sc.entityType === 'TEAM' ? (teamName.get(sc.entityId) ?? null) : null;

        return {
          ...c,
          snapshot: {
            ...c.snapshot,
            marketLabel: streakMarketLabel(sc.marketDefinition.displayName, scope, name),
            subject: marketSubjectOf(scope, name),
          },
        };
      }),
    }));

    return {
      date: start.toISOString().slice(0, 10),
      caveat:
        'Combined probability is the product of component hit rates and assumes independence. Components are historical records, not predictions.',
      clusters: decorated,
    };
  }

  /**
   * Cluster performance: predicted versus actual, which is what the client
   * asked for as the basis of empirical calibration later.
   */
  async performance() {
    const clusters = await this.prisma.cluster.findMany({
      include: {
        components: {
          include: { snapshot: { include: { result: { select: { result: true } } } } },
        },
      },
    });

    const settled = clusters.filter((c) =>
      c.components.every((comp) => comp.snapshot.result != null),
    );

    const rows = settled.map((c) => {
      const wins = c.components.filter(
        (comp) => comp.snapshot.result?.result === ObservationResult.WIN,
      ).length;

      return {
        clusterId: c.id,
        date: c.date,
        size: c.componentCount,
        predicted: c.combinedProbability,
        componentsWon: wins,
        allWon: wins === c.componentCount,
      };
    });

    const bySize = new Map<number, { n: number; allWon: number; predictedSum: number }>();
    for (const r of rows) {
      const entry = bySize.get(r.size) ?? { n: 0, allWon: 0, predictedSum: 0 };
      entry.n++;
      if (r.allWon) entry.allWon++;
      entry.predictedSum += r.predicted;
      bySize.set(r.size, entry);
    }

    return {
      settledClusters: rows.length,
      note:
        rows.length < 100
          ? `Only ${rows.length} settled clusters. Calibration needs a few hundred before predicted and actual can be meaningfully compared.`
          : 'Compare predicted against actual per size. A persistent gap means the independence assumption is overstating combined probability.',
      bySize: [...bySize.entries()].map(([size, e]) => ({
        size,
        settled: e.n,
        predictedRate: e.predictedSum / e.n,
        actualRate: e.allWon / e.n,
      })),
    };
  }
}
