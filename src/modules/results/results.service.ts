import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/common/prisma/prisma.service';
import { isInternationalCompetition } from '@/common/international';
import { streakMarketLabel } from '@/common/market-copy';
import { marketScope } from '@/modules/streaks/market-definitions';
import { shownChance } from '@/modules/streaks/recent-form';
import { betKey } from '@/modules/streaks/bet-key';
import { dropContradictions } from '@/modules/streaks/contradictions';
import { engineSettings } from '@/modules/streaks/engine-settings';
import { firstOfEach } from '@/modules/record/first-of-each';
import { clusterOutcome, driverOf, hitRate, hitRateBy } from './results-summary';

export type ResultsType = 'picks' | 'streaks' | 'clusters';
export type ResultsScope = 'all' | 'club' | 'international';

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

  async list(type: ResultsType, hours: number, scope: ResultsScope) {
    const since = new Date(Date.now() - hours * 3_600_000);
    const now = new Date();
    if (type === 'picks') return this.picks(since, scope);
    if (type === 'clusters') return this.clusters(since, now, scope);
    return this.streaks(since, now, scope);
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

  private async picks(since: Date, scope: ResultsScope) {
    const rows = await this.prisma.pickResult.findMany({
      where: { kickoffAt: { gte: since } },
      orderBy: [{ kickoffAt: 'desc' }, { rank: 'asc' }],
      select: {
        marketName: true,
        rank: true,
        probability: true,
        result: true,
        event: { select: this.eventSelect },
      },
      take: 3000,
    });

    const items = rows
      .map((r) => ({ ...r, match: this.head(r.event) }))
      .filter((r) => this.inScope(r.match.international, scope));

    const matches = this.group(items, (r) => ({
      label: r.marketName,
      result: String(r.result),
      probability: r.probability,
    }));
    const flat = items.map((r) => ({ result: String(r.result), probability: r.probability }));
    return {
      type: 'picks' as const,
      summary: {
        overall: hitRate(flat),
        byScope: hitRateBy(
          items.map((r) => ({ result: String(r.result), probability: r.probability, k: r.match.international ? 'international' : 'club' })),
          (i) => i.k,
        ),
      },
      matches,
    };
  }

  private async streaks(since: Date, now: Date, scope: ResultsScope) {
    const found = await this.prisma.streakSnapshot.findMany({
      where: { kickoffAt: { gte: since, lt: now }, result: { isNot: null } },
      // Earliest capture first, so counting once keeps what was shown first.
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
      take: 3000,
    });

    // The same bet could be captured more than once (one copy per engine run,
    // or one per team on a fixture market) before 7 Oct; count it once.
    const rows = engineSettings().countOnce
      ? firstOfEach(found, (r) => betKey({ eventId: r.eventId, ...r.streakCandidate }))
      : found;
    const shown = engineSettings().hideContradictions
      ? dropContradictions(
          rows,
          (r) => r.eventId,
          (r) => ({
            marketId: r.streakCandidate.marketDefinition.marketId,
            team: marketScope(r.streakCandidate.marketDefinition.marketId) === 'TEAM' ? r.streakCandidate.entityId : null,
          }),
          (r) => shownChance(r.streakCandidate.context, r.hitRate),
        )
      : rows;

    const teamIds = [...new Set(shown.filter((r) => r.streakCandidate.entityType === 'TEAM').map((r) => r.streakCandidate.entityId))];
    const teams = teamIds.length
      ? await this.prisma.team.findMany({ where: { id: { in: teamIds } }, select: { id: true, name: true } })
      : [];
    const teamName = new Map(teams.map((t) => [t.id, t.name]));

    const items = shown
      .map((r) => {
        const sc = r.streakCandidate;
        const ctx = (sc.context ?? {}) as { emerging?: boolean };
        const tier = sc.survivedGate ? 'evidence' : ctx.emerging ? 'emerging' : 'exploratory';
        const name = sc.entityType === 'TEAM' ? teamName.get(sc.entityId) ?? null : null;
        return {
          match: this.head(r.event),
          label: streakMarketLabel(sc.marketDefinition.displayName, marketScope(sc.marketDefinition.marketId), name),
          result: String(r.result?.result ?? 'UNKNOWN'),
          probability: shownChance(sc.context, r.hitRate),
          tier,
          driver: driverOf(sc.context, r.hitRate),
        };
      })
      .filter((r) => this.inScope(r.match.international, scope));

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

  private async clusters(since: Date, now: Date, scope: ResultsScope) {
    const rows = await this.prisma.cluster.findMany({
      where: { date: { gte: new Date(since.getTime() - 86_400_000), lt: now } },
      orderBy: { date: 'desc' },
      select: {
        id: true,
        date: true,
        type: true,
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
                    context: true,
                    marketDefinition: { select: { marketId: true, displayName: true } },
                  },
                },
              },
            },
          },
        },
      },
      take: 300,
    });

    const teamIds = new Set<string>();
    for (const c of rows)
      for (const k of c.components)
        if (k.snapshot.streakCandidate.entityType === 'TEAM') teamIds.add(k.snapshot.streakCandidate.entityId);
    const teams = teamIds.size
      ? await this.prisma.team.findMany({ where: { id: { in: [...teamIds] } }, select: { id: true, name: true } })
      : [];
    const teamName = new Map(teams.map((t) => [t.id, t.name]));

    const built = rows
      .map((c) => {
        const legs = c.components.map((k) => {
          const s = k.snapshot;
          const sc = s.streakCandidate;
          const name = sc.entityType === 'TEAM' ? teamName.get(sc.entityId) ?? null : null;
          return {
            match: this.head(s.event),
            label: streakMarketLabel(sc.marketDefinition.displayName, marketScope(sc.marketDefinition.marketId), name),
            result: s.result?.result ? String(s.result.result) : null,
            // The honest chance where the cluster was built with one; older
            // clusters were built on the raw record and keep showing it.
            probability: (sc.context as { chance?: number } | null)?.chance ?? s.hitRate,
            key: betKey({ eventId: s.eventId, ...sc }),
          };
        });
        return {
          id: c.id,
          date: c.date,
          tier: c.type,
          combinedProbability: c.combinedProbability,
          outcome: clusterOutcome(legs.map((l) => l.result)),
          international: legs.some((l) => l.match.international),
          lastKickoff: legs.reduce((t, l) => Math.max(t, l.match.kickoffAt.getTime()), 0),
          signature: legs.map((l) => l.key).sort().join(' + '),
          legs: legs.map(({ key: _key, ...l }) => l),
        };
      })
      // Only clusters whose matches have all been played, inside the window.
      .filter((c) => c.lastKickoff < now.getTime() && c.lastKickoff >= since.getTime())
      .filter((c) => this.inScope(c.international, scope));
    // The same selections rebuilt into a second cluster count once.
    const clusters = (engineSettings().countOnce ? firstOfEach(built, (c) => c.signature) : built).map(
      ({ signature: _s, ...c }) => c,
    );

    const decided = clusters.filter((c) => c.outcome === 'WIN' || c.outcome === 'LOSS');
    return {
      type: 'clusters' as const,
      summary: {
        overall: hitRate(decided.map((c) => ({ result: c.outcome, probability: c.combinedProbability }))),
        legs: hitRate(clusters.flatMap((c) => c.legs.map((l) => ({ result: l.result ?? 'UNKNOWN', probability: l.probability })))),
      },
      clusters,
    };
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
