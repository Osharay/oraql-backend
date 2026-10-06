import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/common/prisma/prisma.service';
import { isInternationalCompetition } from '@/common/international';
import { streakMarketLabel } from '@/common/market-copy';
import { marketScope } from '@/modules/streaks/market-definitions';
import { londonDay, londonDayStart } from '@/common/london-day';
import { betKey } from '@/modules/streaks/bet-key';
import {
  clusterOutcome,
  driverOf,
  firstOfEach,
  hitRate,
  hitRateBy,
  publishedBeforeKickoff,
  type SettledItem,
} from './results-summary';

export type ResultsType = 'picks' | 'streaks' | 'clusters';
export type ResultsScope = 'all' | 'club' | 'international';
export interface ResultsWindow {
  since: Date;
  until: Date;
}

export interface MatchHead {
  eventId: string;
  kickoffAt: Date;
  home: string;
  away: string;
  score: string | null;
  league: string;
  country: string | null;
  international: boolean;
}

/**
 * What OraQL picked for matches that have finished, and how each landed —
 * the client's way to see where it goes wrong while the engine is tested.
 *
 * Three lists, as on the rest of the site: the dashboard's OraQL Picks, the
 * Streaks (by tier) and the Clusters. Each comes with its hit rate against the
 * chance OraQL gave, split by club and international and, for streaks, by
 * whether the pick was led by recent form or by the season.
 */
@Injectable()
export class ResultsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(type: ResultsType, window: ResultsWindow, scope: ResultsScope) {
    if (type === 'picks') return this.picks(window, scope);
    if (type === 'clusters') return this.clusters(window, scope);
    return this.streaks(window, scope);
  }

  /**
   * The record day by day — for showing what OraQL called and how it went.
   *
   * Counted on the same rules as the lists: only calls published before
   * kickoff, each bet once, losses in. Days are UK days, by kickoff.
   */
  async daily(days: number, scope: ResultsScope) {
    const now = new Date();
    const first = londonDayStart(londonDay(new Date(now.getTime() - (days - 1) * 86_400_000)))!;
    const window = { since: first, until: now };
    const [picks, streaks, clusters] = await Promise.all([
      this.pickItems(window, scope, 20_000),
      this.streakItems(window, scope, 20_000),
      this.clusterItems(window, scope),
    ]);

    type Bucket = { picks: SettledItem[]; streaks: SettledItem[]; evidence: SettledItem[]; clusters: SettledItem[] };
    const byDay = new Map<string, Bucket>();
    const bucket = (d: Date) => {
      const k = londonDay(d);
      let b = byDay.get(k);
      if (!b) byDay.set(k, (b = { picks: [], streaks: [], evidence: [], clusters: [] }));
      return b;
    };
    for (const p of picks) bucket(p.match.kickoffAt).picks.push(p);
    for (const s of streaks) {
      const b = bucket(s.match.kickoffAt);
      b.streaks.push(s);
      if (s.tier === 'evidence') b.evidence.push(s);
    }
    for (const c of clusters) {
      if (c.outcome !== 'WIN' && c.outcome !== 'LOSS') continue;
      bucket(new Date(c.firstKickoff)).clusters.push({ result: c.outcome, probability: c.combinedProbability });
    }

    const rates = (b: Bucket) => ({
      picks: hitRate(b.picks),
      streaks: hitRate(b.streaks),
      evidence: hitRate(b.evidence),
      clusters: hitRate(b.clusters),
    });
    const all: Bucket = { picks: [], streaks: [], evidence: [], clusters: [] };
    for (const b of byDay.values())
      (Object.keys(all) as Array<keyof Bucket>).forEach((k) => all[k].push(...b[k]));

    return {
      days: [...byDay.entries()]
        .map(([date, b]) => ({ date, ...rates(b) }))
        .filter((d) => d.picks.settled + d.streaks.settled + d.clusters.settled > 0)
        .sort((a, b) => (a.date < b.date ? 1 : -1)),
      totals: rates(all),
      from: londonDay(first),
      to: londonDay(now),
    };
  }

  private head(e: {
    id: string;
    kickoffAt: Date;
    ftHomeScore: number | null;
    ftAwayScore: number | null;
    homeScore: number | null;
    awayScore: number | null;
    homeTeam: { name: string };
    awayTeam: { name: string };
    league: { name: string; country: string | null };
  }): MatchHead {
    const h = e.ftHomeScore ?? e.homeScore;
    const a = e.ftAwayScore ?? e.awayScore;
    return {
      eventId: e.id,
      kickoffAt: e.kickoffAt,
      home: e.homeTeam.name,
      away: e.awayTeam.name,
      score: h != null && a != null ? `${h}–${a}` : null,
      league: e.league.name,
      country: e.league.country,
      international: isInternationalCompetition(e.league.name, e.league.country),
    };
  }

  private inScope(international: boolean, scope: ResultsScope) {
    return scope === 'all' || (scope === 'international') === international;
  }

  private readonly eventSelect = {
    id: true,
    kickoffAt: true,
    ftHomeScore: true,
    ftAwayScore: true,
    homeScore: true,
    awayScore: true,
    homeTeam: { select: { name: true } },
    awayTeam: { select: { name: true } },
    league: { select: { name: true, country: true } },
  } as const;

  /** Settled OraQL picks in the window — only those made before kickoff. */
  private async pickItems(w: ResultsWindow, scope: ResultsScope, take = 3000) {
    const rows = await this.prisma.pickResult.findMany({
      where: { kickoffAt: { gte: w.since, lt: w.until } },
      orderBy: [{ kickoffAt: 'desc' }, { rank: 'asc' }],
      select: {
        marketName: true,
        rank: true,
        probability: true,
        result: true,
        kickoffAt: true,
        pickedAt: true,
        event: { select: this.eventSelect },
      },
      take,
    });
    return rows
      .filter((r) => publishedBeforeKickoff(r.pickedAt, r.kickoffAt))
      .map((r) => ({ label: r.marketName, result: String(r.result), probability: r.probability, match: this.head(r.event) }))
      .filter((r) => this.inScope(r.match.international, scope));
  }

  private async picks(w: ResultsWindow, scope: ResultsScope) {
    const items = await this.pickItems(w, scope);
    return {
      type: 'picks' as const,
      summary: {
        overall: hitRate(items),
        byScope: hitRateBy(items, (i) => (i.match.international ? 'international' : 'club')),
      },
      matches: this.group(items, (r) => ({ label: r.label, result: r.result, probability: r.probability })),
    };
  }

  /**
   * Settled streak snapshots in the window, each bet once.
   *
   * Snapshots are captured before a cutoff ahead of kickoff, so all of these
   * were published in time. The same bet can have several (one per engine
   * run, or from both teams of a fixture market); the first capture stands.
   */
  private async streakItems(w: ResultsWindow, scope: ResultsScope, take = 3000) {
    const until = w.until < new Date() ? w.until : new Date();
    const rows = await this.prisma.streakSnapshot.findMany({
      where: { kickoffAt: { gte: w.since, lt: until }, result: { isNot: null } },
      orderBy: [{ kickoffAt: 'desc' }, { capturedAt: 'asc' }],
      select: {
        eventId: true,
        hitRate: true,
        result: { select: { result: true } },
        event: { select: this.eventSelect },
        streakCandidate: {
          select: {
            survivedGate: true,
            context: true,
            entityType: true,
            entityId: true,
            selection: true,
            marketDefinitionId: true,
            marketDefinition: { select: { marketId: true, displayName: true } },
          },
        },
      },
      take,
    });

    const unique = firstOfEach(rows, (r) =>
      betKey({
        eventId: r.eventId,
        marketDefinitionId: r.streakCandidate.marketDefinitionId,
        selection: r.streakCandidate.selection,
        entityId: r.streakCandidate.entityId,
      }),
    );
    const teamName = await this.teamNames(unique.map((r) => r.streakCandidate));

    return unique
      .map((r) => {
        const sc = r.streakCandidate;
        const ctx = (sc.context ?? {}) as { emerging?: boolean; formRate?: number };
        const tier = sc.survivedGate ? 'evidence' : ctx.emerging ? 'emerging' : 'exploratory';
        const name = sc.entityType === 'TEAM' ? teamName.get(sc.entityId) ?? null : null;
        return {
          match: this.head(r.event),
          label: streakMarketLabel(sc.marketDefinition.displayName, marketScope(sc.marketDefinition.marketId), name),
          result: String(r.result?.result ?? 'UNKNOWN'),
          probability: typeof ctx.formRate === 'number' ? ctx.formRate : r.hitRate,
          tier,
          driver: driverOf(sc.context, r.hitRate),
        };
      })
      .filter((r) => this.inScope(r.match.international, scope));
  }

  private async streaks(w: ResultsWindow, scope: ResultsScope) {
    const items = await this.streakItems(w, scope);
    return {
      type: 'streaks' as const,
      summary: {
        overall: hitRate(items),
        byTier: hitRateBy(items, (i) => i.tier),
        byScope: hitRateBy(items, (i) => (i.match.international ? 'international' : 'club')),
        byDriver: hitRateBy(items, (i) => i.driver),
      },
      matches: this.group(items, (r) => ({
        label: r.label,
        result: r.result,
        probability: r.probability,
        tier: r.tier,
        driver: r.driver,
      })),
    };
  }

  /**
   * Clusters whose matches have all been played inside the window.
   *
   * Only clusters built before their first match kicked off count, and a
   * cluster repeated with the same selections is shown once.
   */
  private async clusterItems(w: ResultsWindow, scope: ResultsScope) {
    const now = new Date();
    const rows = await this.prisma.cluster.findMany({
      where: { date: { gte: new Date(w.since.getTime() - 86_400_000), lt: w.until } },
      orderBy: [{ date: 'desc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        date: true,
        type: true,
        createdAt: true,
        combinedProbability: true,
        components: {
          orderBy: { rank: 'asc' },
          select: {
            snapshot: {
              select: {
                eventId: true,
                kickoffAt: true,
                hitRate: true,
                result: { select: { result: true } },
                event: { select: this.eventSelect },
                streakCandidate: {
                  select: {
                    entityType: true,
                    entityId: true,
                    selection: true,
                    marketDefinitionId: true,
                    marketDefinition: { select: { marketId: true, displayName: true } },
                  },
                },
              },
            },
          },
        },
      },
      take: 2000,
    });

    const teamName = await this.teamNames(rows.flatMap((c) => c.components.map((k) => k.snapshot.streakCandidate)));

    const built = rows
      .filter((c) => c.components.length > 0)
      .map((c) => {
        const legs = c.components.map((k) => {
          const s = k.snapshot;
          const sc = s.streakCandidate;
          const name = sc.entityType === 'TEAM' ? teamName.get(sc.entityId) ?? null : null;
          return {
            key: betKey({ eventId: s.eventId, ...sc }),
            match: this.head(s.event),
            label: streakMarketLabel(sc.marketDefinition.displayName, marketScope(sc.marketDefinition.marketId), name),
            result: s.result?.result ? String(s.result.result) : null,
            probability: s.hitRate,
          };
        });
        const kicks = legs.map((l) => l.match.kickoffAt.getTime());
        return {
          id: c.id,
          date: c.date,
          tier: c.type,
          combinedProbability: c.combinedProbability,
          outcome: clusterOutcome(legs.map((l) => l.result)),
          international: legs.some((l) => l.match.international),
          createdAt: c.createdAt.getTime(),
          firstKickoff: Math.min(...kicks),
          lastKickoff: Math.max(...kicks),
          signature: legs.map((l) => l.key).sort().join(' + '),
          legs: legs.map(({ key: _key, ...l }) => l),
        };
      })
      // A pre-match call, played out inside the window.
      .filter((c) => c.createdAt < c.firstKickoff)
      .filter((c) => c.lastKickoff < now.getTime() && c.lastKickoff >= w.since.getTime() && c.lastKickoff < w.until.getTime())
      .filter((c) => this.inScope(c.international, scope));

    return firstOfEach(built, (c) => c.signature).map(({ signature: _s, createdAt: _c, ...c }) => c);
  }

  private async clusters(w: ResultsWindow, scope: ResultsScope) {
    const clusters = await this.clusterItems(w, scope);
    const decided = clusters.filter((c) => c.outcome === 'WIN' || c.outcome === 'LOSS');
    return {
      type: 'clusters' as const,
      summary: {
        overall: hitRate(decided.map((c) => ({ result: c.outcome, probability: c.combinedProbability }))),
        legs: hitRate(clusters.flatMap((c) => c.legs.map((l) => ({ result: l.result ?? 'UNKNOWN', probability: l.probability })))),
      },
      clusters: clusters.map(({ firstKickoff: _f, ...c }) => c),
    };
  }

  private async teamNames(cands: Array<{ entityType: string; entityId: string }>) {
    const ids = [...new Set(cands.filter((c) => c.entityType === 'TEAM').map((c) => c.entityId))];
    const teams = ids.length
      ? await this.prisma.team.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })
      : [];
    return new Map(teams.map((t) => [t.id, t.name]));
  }

  /** Items under their match, most recent match first. */
  private group<T extends { match: MatchHead }, R>(items: T[], row: (i: T) => R) {
    const byEvent = new Map<string, { match: MatchHead; items: R[] }>();
    for (const i of items) {
      const g = byEvent.get(i.match.eventId) ?? { match: i.match, items: [] };
      g.items.push(row(i));
      byEvent.set(i.match.eventId, g);
    }
    return [...byEvent.values()].sort((a, b) => b.match.kickoffAt.getTime() - a.match.kickoffAt.getTime());
  }
}
