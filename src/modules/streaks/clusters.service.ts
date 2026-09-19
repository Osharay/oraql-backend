import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@/common/prisma/prisma.service';
import { ObservationResult, StreakStatus } from '@prisma/client';

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
    const clusters: Array<typeof snapshots> = [];

    for (let i = 0; i < count; i++) {
      const picked = this.pickDiverseSet(snapshots, used, size, requireDistinctLeague);
      if (picked.length < 2) break; // a cluster of one is just a streak
      picked.forEach((s) => used.add(s.id));
      clusters.push(picked);
    }

    let created = 0;

    for (const components of clusters) {
      // Product of component hit rates. An independence approximation, and
      // labelled as one: same-day football correlates through weather,
      // refereeing and league-wide scoring trends.
      const combinedProbability = components.reduce((p, c) => p * c.hitRate, 1);

      const cluster = await this.prisma.cluster.create({
        data: {
          date: start,
          type: 'DAILY_STRONGEST',
          componentCount: components.length,
          combinedProbability,
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

  /**
   * Greedy selection: strongest first, skipping anything that repeats an event
   * or a market already in the set.
   */
  private pickDiverseSet<
    T extends {
      id: string;
      eventId: string;
      event: { leagueId: string };
      streakCandidate: { marketDefinitionId: string };
    },
  >(pool: T[], used: Set<string>, size: number, requireDistinctLeague: boolean): T[] {
    const chosen: T[] = [];
    const events = new Set<string>();
    const markets = new Set<string>();
    const leagues = new Set<string>();

    for (const s of pool) {
      if (chosen.length >= size) break;
      if (used.has(s.id)) continue;
      if (events.has(s.eventId)) continue;
      if (markets.has(s.streakCandidate.marketDefinitionId)) continue;
      if (requireDistinctLeague && leagues.has(s.event.leagueId)) continue;

      chosen.push(s);
      events.add(s.eventId);
      markets.add(s.streakCandidate.marketDefinitionId);
      leagues.add(s.event.leagueId);
    }

    return chosen;
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

    return {
      date: start.toISOString().slice(0, 10),
      caveat:
        'Combined probability is the product of component hit rates and assumes independence. Components are historical records, not predictions.',
      clusters,
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
