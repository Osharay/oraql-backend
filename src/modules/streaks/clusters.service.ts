import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@/common/prisma/prisma.service';
import { ObservationResult, StreakStatus } from '@prisma/client';
import {
  combinedProbability,
  meetsClusterBar,
  pickDiverseComponents,
  trimToBar,
  MIN_CLUSTER_SIZE,
  type Selectable,
} from './cluster-selection';
import { engineSettings } from './engine-settings';
import { marketScope } from './market-definitions';
import { tierOf, type ClusterType } from './cluster-tiers';
import { betKey } from './bet-key';
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
/** The snapshot fields cluster assembly reads. */
interface SnapshotRow {
  id: string;
  eventId: string;
  hitRate: number;
  lift: number;
  strengthScore: number;
  event: { leagueId: string };
  streakCandidate: {
    marketDefinitionId: string;
    survivedGate: boolean;
    selection: string | null;
    entityId: string;
    context: unknown;
    marketDefinition: { marketId: string };
  };
}

/** What a cluster's type means to the reader. */
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
    includeSuggestive?: boolean;
  }) {
    const settings = engineSettings();
    const bar = settings.clusterBar;
    const size = Math.min(options?.size ?? (bar ? settings.clusterSize : this.DEFAULT_SIZE), this.MAX_SIZE);
    const count = options?.count ?? 3;
    const requireDistinctLeague = options?.requireDistinctLeague ?? false;
    const includeSuggestive = options?.includeSuggestive ?? true;

    const day = options?.date ? new Date(options.date) : new Date();
    const start = new Date(day);
    start.setHours(0, 0, 0, 0);
    const end = new Date(day);
    end.setHours(23, 59, 59, 999);

    // Only matches still to kick off: a cluster is a pre-match call, and one
    // built after a leg has started could be built from hindsight.
    const now = new Date();
    const fromTime = now > start ? now : start;
    const found = await this.prisma.streakSnapshot.findMany({
      where: { kickoffAt: { gt: fromTime, lte: end }, result: null },
      select: {
        id: true,
        hitRate: true,
        lift: true,
        strengthScore: true,
        eventId: true,
        event: { select: { leagueId: true } },
        streakCandidate: {
          select: {
            marketDefinitionId: true,
            survivedGate: true,
            selection: true,
            entityId: true,
            context: true,
            marketDefinition: { select: { marketId: true } },
          },
        },
      },
      orderBy: [{ strengthScore: 'desc' }, { lift: 'desc' }],
    });

    // The same bet can be captured more than once (one row per engine run, or
    // from both teams of a fixture market). Keep the strongest of each, or a
    // day's clusters come out as the same two selections three times over.
    const bets = new Set<string>();
    const snapshots = found.filter((s) => {
      const k = betKey({ eventId: s.eventId, ...s.streakCandidate });
      if (bets.has(k)) return false;
      bets.add(k);
      return true;
    });

    // A rebuild replaces only clusters none of whose matches have started.
    // One already under way is on the record, win or lose, and stays as it was.
    const existing = await this.prisma.cluster.findMany({
      where: { date: { gte: start, lte: end } },
      select: { id: true, components: { select: { snapshot: { select: { kickoffAt: true, eventId: true } } } } },
    });
    const locked = existing.filter((c) => c.components.some((k) => k.snapshot.kickoffAt <= now));
    const replaceable = existing.filter((c) => !locked.includes(c)).map((c) => c.id);

    if (snapshots.length === 0) {
      return { created: 0, note: locked.length ? 'Clusters for this date have already started' : 'No snapshots available for this date' };
    }

    if (replaceable.length) await this.prisma.cluster.deleteMany({ where: { id: { in: replaceable } } });

    const used = new Set<string>();
    const clusters: Array<{ components: Selectable[]; type: ClusterType }> = [];

    // Flatten to the shape the selection rules work on. A suggestive snapshot
    // has no strength score (that is only awarded past the gate), so it is
    // ranked on lift instead — and never mixed into a gated cluster.
    // With the bar on, `hitRate` carries the honest chance and picks are ranked
    // on it first: a cluster is meant to land, so the likeliest strong picks
    // lead, not the most unusual ones.
    const chanceOf = (s: SnapshotRow) => (s.streakCandidate.context as { chance?: number } | null)?.chance ?? s.hitRate;
    const flatten = (rows: SnapshotRow[]): Selectable[] =>
      rows.map((s) => ({
        id: s.id,
        eventId: s.eventId,
        leagueId: s.event.leagueId,
        marketDefinitionId: s.streakCandidate.marketDefinitionId,
        hitRate: bar ? chanceOf(s) : s.hitRate,
        strengthScore: bar ? chanceOf(s) + (s.strengthScore || s.lift) / 1000 : s.strengthScore || s.lift,
      }));

    const rows: SnapshotRow[] = bar
      ? snapshots.filter((s) =>
          meetsClusterBar(
            {
              chance: chanceOf(s),
              marketId: s.streakCandidate.marketDefinition.marketId,
              emerging: (s.streakCandidate.context as { emerging?: boolean } | null)?.emerging === true,
              survivedGate: s.streakCandidate.survivedGate,
            },
            settings.clusterMinLeg,
          ),
        )
      : snapshots;
    const gated = flatten(rows.filter((s) => s.streakCandidate.survivedGate));
    const suggestive = flatten(rows.filter((s) => !s.streakCandidate.survivedGate));

    // A match goes into one of the day's clusters only: three clusters that
    // each lean on the same Flamengo game all fail together if it goes wrong.
    const usedEvents = new Set<string>(
      bar ? locked.flatMap((c) => c.components.map((k) => k.snapshot.eventId)) : [],
    );
    const fill = (pool: Selectable[], type: ClusterType, want: number) => {
      for (let i = 0; i < want; i++) {
        const open = bar ? pool.filter((p) => !usedEvents.has(p.eventId)) : pool;
        const found = pickDiverseComponents(open, { size, requireDistinctLeague, used });
        const picked = bar ? trimToBar(found, settings.clusterMinCombined) : found;
        if (!picked || picked.length < MIN_CLUSTER_SIZE) break;
        picked.forEach((p) => {
          used.add(p.id);
          if (bar) usedEvents.add(p.eventId);
        });
        clusters.push({ components: picked, type });
      }
    };

    // Evidence first. Suggestive clusters only fill the space the gated ones
    // left, so a day with real findings never shows a weaker one above them.
    const room = Math.max(count - locked.length, 0);
    fill(gated, 'DAILY_STRONGEST', room);
    if (includeSuggestive) fill(suggestive, 'DAILY_SUGGESTIVE', room - clusters.length);

    let created = 0;

    for (const { components, type } of clusters) {
      const cluster = await this.prisma.cluster.create({
        data: {
          date: start,
          type,
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

    const strongest = clusters.filter((c) => c.type === 'DAILY_STRONGEST').length;
    const suggested = clusters.length - strongest;

    this.logger.log(
      `Built ${created} clusters for ${start.toISOString().slice(0, 10)} ` +
        `(${strongest} evidence-backed, ${suggested} suggestive) from ${snapshots.length} snapshots`,
    );

    return {
      created,
      strongest,
      suggestive: suggested,
      snapshotsConsidered: snapshots.length,
      note:
        bar && created < room
          ? `${created === 0 ? 'No' : `Only ${created}`} cluster${created === 1 ? '' : 's'} cleared the bar today: every selection at least ${Math.round(settings.clusterMinLeg * 100)}% and the whole cluster at least ${Math.round(settings.clusterMinCombined * 100)}%.`
          : created === 0
          ? 'Not enough diverse snapshots to form a cluster — each component must come from a different event and a different market.'
          : suggested > 0 && strongest === 0
            ? 'Nothing cleared the gate today, so these are suggestive: strong recent form that has not been shown to be more than luck. Combined probability assumes independence and is an approximation.'
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
                    // Enough for a row to open into the match it is about.
                    id: true,
                    kickoffAt: true,
                    homeTeam: { select: { id: true, name: true, shortName: true } },
                    awayTeam: { select: { id: true, name: true, shortName: true } },
                    league: { select: { name: true, country: true } },
                  },
                },
                streakCandidate: {
                  select: {
                    selection: true,
                    entityType: true,
                    entityId: true,
                    wins: true,
                    last10: true,
                    context: true,
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
      // Evidence-backed clusters always come before suggestive ones.
      orderBy: [{ type: 'asc' }, { combinedProbability: 'desc' }],
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
      // Say plainly which kind of cluster this is. A suggestive one read as
      // an evidence-backed one is the whole risk of showing it at all.
      ...tierOf(cluster.type),
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
