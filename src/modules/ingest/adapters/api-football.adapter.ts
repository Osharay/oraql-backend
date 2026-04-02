import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  IDataProvider,
  FixtureData,
  LeagueData,
  TeamData,
  MatchStatsData,
  LineupData,
  InjuryData,
  PlayerData,
  OddsData,
} from '../interfaces/data-provider.interface';

/**
 * API-Football adapter — primary data source.
 * Docs: https://www.api-football.com/documentation-v3
 */
@Injectable()
export class ApiFootballAdapter implements IDataProvider {
  readonly name = 'api_football';
  private readonly logger = new Logger(ApiFootballAdapter.name);
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(private readonly config: ConfigService) {
    this.baseUrl = config.get<string>('dataProviders.apiFootball.baseUrl')!;
    this.apiKey = config.get<string>('dataProviders.apiFootball.key') || '';
  }

  private async request<T>(endpoint: string, params: Record<string, string> = {}): Promise<T> {
    const url = new URL(`${this.baseUrl}/${endpoint}`);
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

    const response = await fetch(url.toString(), {
      headers: {
        'x-apisports-key': this.apiKey,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorBody = await response.text();
      this.logger.error(`API-Football ${endpoint} failed: ${response.status} — ${errorBody}`);
      throw new Error(`API-Football request failed: ${response.status}`);
    }

    const data = await response.json();

    // API-Football rate limit tracking
    const remaining = response.headers.get('x-ratelimit-requests-remaining');
    if (remaining && parseInt(remaining, 10) < 100) {
      this.logger.warn(`API-Football rate limit low: ${remaining} requests remaining`);
    }

    return data.response as T;
  }

  async getFixtures(date: string, leagueId?: string): Promise<FixtureData[]> {
    const params: Record<string, string> = { date };
    if (leagueId) params.league = leagueId;

    const raw = await this.request<any[]>('fixtures', params);

    return raw.map((f) => ({
      externalId: String(f.fixture.id),
      leagueExternalId: String(f.league.id),
      homeTeamExternalId: String(f.teams.home.id),
      awayTeamExternalId: String(f.teams.away.id),
      kickoffAt: new Date(f.fixture.date),
      venue: f.fixture.venue?.name,
      round: f.league.round,
      status: this.mapStatus(f.fixture.status.short),
      homeScore: f.goals.home,
      awayScore: f.goals.away,
    }));
  }

  async getLeagues(season: number): Promise<LeagueData[]> {
    const raw = await this.request<any[]>('leagues', { season: String(season) });

    return raw.map((l) => ({
      externalId: String(l.league.id),
      name: l.league.name,
      country: l.country?.name,
      countryCode: l.country?.code,
      logoUrl: l.league.logo,
      season,
    }));
  }

  async getTeams(leagueExternalId: string, season: number): Promise<TeamData[]> {
    const raw = await this.request<any[]>('teams', {
      league: leagueExternalId,
      season: String(season),
    });

    return raw.map((t) => ({
      externalId: String(t.team.id),
      name: t.team.name,
      shortName: t.team.code,
      logoUrl: t.team.logo,
      country: t.team.country,
      venueName: t.venue?.name,
      venueCity: t.venue?.city,
    }));
  }

  async getMatchStats(teamExternalId: string, last = 10): Promise<MatchStatsData[]> {
    const raw = await this.request<any[]>('fixtures', {
      team: teamExternalId,
      last: String(last),
    });

    const stats: MatchStatsData[] = [];

    for (const fixture of raw) {
      // Fetch detailed stats for each fixture
      const fixtureStats = await this.request<any[]>('fixtures/statistics', {
        fixture: String(fixture.fixture.id),
        team: teamExternalId,
      });

      if (fixtureStats.length > 0) {
        const s = fixtureStats[0];
        const getStat = (type: string) => {
          const found = s.statistics?.find((st: any) => st.type === type);
          return found?.value;
        };

        const isHome = String(fixture.teams.home.id) === teamExternalId;
        const teamGoals = isHome ? fixture.goals.home : fixture.goals.away;

        stats.push({
          fixtureExternalId: String(fixture.fixture.id),
          teamExternalId,
          goals: teamGoals || 0,
          shotsTotal: getStat('Total Shots'),
          shotsOnTarget: getStat('Shots on Goal'),
          possession: parseFloat(getStat('Ball Possession')?.replace('%', '') || '0'),
          corners: getStat('Corner Kicks') || 0,
          yellowCards: getStat('Yellow Cards') || 0,
          redCards: getStat('Red Cards') || 0,
          fouls: getStat('Fouls'),
          offsides: getStat('Offsides'),
          saves: getStat('Goalkeeper Saves'),
          expectedGoals: parseFloat(getStat('expected_goals') || '0'),
          passAccuracy: parseFloat(getStat('Passes %')?.replace('%', '') || '0'),
        });
      }
    }

    return stats;
  }

  async getLineups(fixtureExternalId: string): Promise<LineupData[]> {
    const raw = await this.request<any[]>('fixtures/lineups', {
      fixture: fixtureExternalId,
    });

    return raw.map((l) => ({
      fixtureExternalId,
      teamExternalId: String(l.team.id),
      formation: l.formation,
      isConfirmed: true,
      starters: (l.startXI || []).map((p: any) => ({
        playerExternalId: String(p.player.id),
        position: p.player.pos,
        gridPosition: p.player.grid,
      })),
      substitutes: (l.substitutes || []).map((p: any) => ({
        playerExternalId: String(p.player.id),
        position: p.player.pos,
      })),
    }));
  }

  async getInjuries(teamExternalId: string): Promise<InjuryData[]> {
    const raw = await this.request<any[]>('injuries', {
      team: teamExternalId,
      season: String(new Date().getFullYear()),
    });

    return raw.map((i) => ({
      playerExternalId: String(i.player.id),
      teamExternalId,
      type: i.player.type || 'Unknown',
      reason: i.player.reason,
      status: this.mapInjuryStatus(i.player.type),
    }));
  }

  async getPlayers(teamExternalId: string, season: number): Promise<PlayerData[]> {
    const raw = await this.request<any[]>('players/squads', {
      team: teamExternalId,
    });

    if (raw.length === 0) return [];

    return (raw[0].players || []).map((p: any) => ({
      externalId: String(p.id),
      name: p.name,
      position: p.position,
      number: p.number,
      photoUrl: p.photo,
      teamExternalId,
    }));
  }

  async getOdds(fixtureExternalId: string): Promise<OddsData[]> {
    const raw = await this.request<any[]>('odds', {
      fixture: fixtureExternalId,
    });

    const odds: OddsData[] = [];

    for (const bookmakerData of raw) {
      for (const bookie of bookmakerData.bookmakers || []) {
        for (const bet of bookie.bets || []) {
          for (const value of bet.values || []) {
            odds.push({
              fixtureExternalId,
              bookmaker: bookie.name,
              marketName: bet.name,
              selection: value.value,
              odds: parseFloat(value.odd),
            });
          }
        }
      }
    }

    return odds;
  }

  // ─── Helpers ───

  private mapStatus(apiStatus: string): string {
    const statusMap: Record<string, string> = {
      TBD: 'SCHEDULED',
      NS: 'SCHEDULED',
      '1H': 'LIVE',
      HT: 'HALF_TIME',
      '2H': 'LIVE',
      ET: 'LIVE',
      P: 'LIVE',
      FT: 'FINISHED',
      AET: 'FINISHED',
      PEN: 'FINISHED',
      BT: 'FINISHED',
      SUSP: 'SUSPENDED',
      INT: 'SUSPENDED',
      PST: 'POSTPONED',
      CANC: 'CANCELLED',
      ABD: 'CANCELLED',
      AWD: 'FINISHED',
      WO: 'FINISHED',
    };
    return statusMap[apiStatus] || 'SCHEDULED';
  }

  private mapInjuryStatus(type: string): string {
    if (!type) return 'Doubtful';
    const lower = type.toLowerCase();
    if (lower.includes('missing') || lower.includes('out')) return 'Out';
    if (lower.includes('doubtful') || lower.includes('questionable')) return 'Doubtful';
    return 'Day-to-Day';
  }
}
