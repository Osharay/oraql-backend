import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@/common/prisma/prisma.service';
import { ObservationResult, ObservationSelection } from '@prisma/client';
import { MARKET_BY_ID, marketScope } from './market-definitions';
import { streakMarketLabel, marketSubjectOf } from '@/common/market-copy';
import {
  FormSort,
  MarketForm,
  Settled,
  compareForm,
  summariseForm,
} from './form-summary';

export type Venue = 'ALL' | 'HOME' | 'AWAY';

export interface TeamMarketForm extends MarketForm {
  marketId: string;
  marketLabel: string;
  scope: 'TEAM' | 'MATCH';
  subject: string;
  category: string;
}

/**
 * Per-team market form — "any random team you look at, you should be able to
 * tell their best performing market streaks".
 *
 * Every market the registry knows, measured over this team's matches: the
 * last `window` results first, the longer record and the market's usual rate
 * beside them. Team markets read the team's own side of each match; match
 * markets (totals, BTTS, half-time totals) read every match the team played.
 *
 * Nothing here is gated. This is the descriptive view the client asked for;
 * the evidence-backed streaks remain the place where luck has been ruled out.
 */
@Injectable()
export class FormService {
  /** About two seasons: the client's limit for home/away history. */
  private readonly LOOKBACK_DAYS = 730;
  private readonly MAX_WINDOW = 20;

  constructor(private readonly prisma: PrismaService) {}

  async teamForm(
    teamId: string,
    options: { window?: number; venue?: Venue; sort?: FormSort; minPlayed?: number } = {},
  ) {
    const window = Math.max(3, Math.min(options.window ?? 10, this.MAX_WINDOW));
    const venue: Venue = options.venue ?? 'ALL';
    const sort: FormSort = options.sort ?? 'lift';
    // A market with a couple of results says nothing; half-time markets on
    // matches ingested before half-time scores were kept are the usual case.
    const minPlayed = Math.max(1, Math.min(options.minPlayed ?? Math.ceil(window / 2), window));

    const team = await this.prisma.team.findUnique({
      where: { id: teamId },
      select: { id: true, name: true, shortName: true },
    });
    if (!team) throw new NotFoundException('Team not found');

    const since = new Date(Date.now() - this.LOOKBACK_DAYS * 86_400_000);
    const settled = { in: [ObservationResult.WIN, ObservationResult.LOSS] };

    const [teamRows, matchRows] = await Promise.all([
      // The team's own side of every team market.
      this.prisma.marketObservation.findMany({
        where: {
          teamId,
          result: settled,
          kickoffAt: { gte: since },
          ...(venue === 'ALL' ? {} : { isHome: venue === 'HOME' }),
        },
        select: {
          marketDefinitionId: true,
          result: true,
          kickoffAt: true,
          leagueId: true,
          season: true,
        },
        orderBy: { kickoffAt: 'desc' },
      }),
      // Match-wide markets in every match the team played.
      this.prisma.marketObservation.findMany({
        where: {
          selection: ObservationSelection.MATCH,
          result: settled,
          kickoffAt: { gte: since },
          event:
            venue === 'HOME'
              ? { homeTeamId: teamId }
              : venue === 'AWAY'
                ? { awayTeamId: teamId }
                : { OR: [{ homeTeamId: teamId }, { awayTeamId: teamId }] },
        },
        select: {
          marketDefinitionId: true,
          result: true,
          kickoffAt: true,
          leagueId: true,
          season: true,
        },
        orderBy: { kickoffAt: 'desc' },
      }),
    ]);

    const rows = [...teamRows, ...matchRows];
    const matchesSeen = new Set(rows.map((r) => r.kickoffAt.getTime())).size;

    // The league and season the team is playing now, for the usual rate.
    const latest = rows.reduce<(typeof rows)[number] | null>(
      (best, r) => (!best || r.kickoffAt > best.kickoffAt ? r : best),
      null,
    );

    const definitions = await this.prisma.marketDefinition.findMany({
      where: { isActive: true },
      select: { id: true, marketId: true, displayName: true, category: true },
    });

    const baselines = await this.prisma.marketBaseline.findMany({
      where: {
        OR: [
          ...(latest ? [{ leagueId: latest.leagueId, season: latest.season }] : []),
          { leagueId: null, season: null },
        ],
      },
      select: { marketDefinitionId: true, leagueId: true, baselineRate: true },
    });
    const scoped = new Map<string, number>();
    const global = new Map<string, number>();
    for (const b of baselines) {
      (b.leagueId ? scoped : global).set(b.marketDefinitionId, b.baselineRate);
    }

    // marketDefinitionId -> results, newest first. Both queries are ordered
    // by kickoff, and a market appears in only one of them, so order holds.
    const byMarket = new Map<string, Settled[]>();
    for (const r of rows) {
      const list = byMarket.get(r.marketDefinitionId) ?? [];
      list.push(r.result as Settled);
      byMarket.set(r.marketDefinitionId, list);
    }

    const teamName = team.shortName || team.name;
    const markets: TeamMarketForm[] = [];

    for (const def of definitions) {
      const results = byMarket.get(def.id);
      if (!results || results.length === 0) continue;

      const spec = MARKET_BY_ID.get(def.marketId);
      if (!spec) continue;

      const baseline = scoped.get(def.id) ?? global.get(def.id) ?? null;
      const form = summariseForm(results, window, baseline);
      if (form.recentPlayed < minPlayed) continue;

      const scope = marketScope(def.marketId);
      markets.push({
        ...form,
        marketId: def.marketId,
        marketLabel: streakMarketLabel(def.displayName, scope, teamName),
        scope,
        // Match markets are measured across this team's matches, not its own
        // goals — say so, or "Over 2.5" reads as the team scoring three.
        subject:
          scope === 'TEAM'
            ? marketSubjectOf(scope, teamName).label
            : `Both teams combined — in ${teamName}'s matches`,
        category: def.category,
      });
    }

    markets.sort(compareForm(sort));

    const unusual = markets.filter((m) => m.chanceBand && m.chanceBand !== 'common').length;

    return {
      team: { id: team.id, name: team.name, shortName: team.shortName },
      window,
      venue,
      sort,
      lookbackDays: this.LOOKBACK_DAYS,
      matchesSeen,
      marketsMeasured: markets.length,
      // With this many markets some rows will look unusual by luck. Saying so
      // on the page keeps a 1-in-20 fluke from reading as a find.
      caveat:
        markets.length > 0
          ? `${markets.length} markets measured. Around ${Math.max(
              1,
              Math.round(markets.length * 0.05),
            )} would look "unusual" by chance alone; ${unusual} do here.`
          : null,
      markets,
    };
  }

  /** Both sides of a fixture, each at the venue they play it at. */
  async fixtureForm(eventId: string, options: { window?: number; sort?: FormSort } = {}) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: {
        id: true,
        kickoffAt: true,
        homeTeamId: true,
        awayTeamId: true,
        league: { select: { name: true } },
      },
    });
    if (!event) throw new NotFoundException('Event not found');

    const [home, away] = await Promise.all([
      this.teamForm(event.homeTeamId, { ...options, venue: 'HOME' }),
      this.teamForm(event.awayTeamId, { ...options, venue: 'AWAY' }),
    ]);

    return { event: { id: event.id, kickoffAt: event.kickoffAt, league: event.league }, home, away };
  }
}
