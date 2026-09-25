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
  TeamRecentMatch,
} from '../interfaces/data-provider.interface';

/** Out of requests for the day. Retrying cannot help, so callers stop. */
export class ApiFootballQuotaExhausted extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApiFootballQuotaExhausted';
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * API-Football adapter — primary data source.
 * Docs: https://www.api-football.com/documentation-v3
 *
 * Every call is paced and 429s are retried. Neither was done before, so a
 * backfill fired its 24 requests back to back, tripped the per-minute limit
 * on the first, and then failed every remaining one in the same second —
 * and the job still logged itself "complete".
 */
@Injectable()
export class ApiFootballAdapter implements IDataProvider {
  /**
   * Whether per-fixture statistics are worth asking for, league by league.
   *
   * The provider carries statistics for the competitions it covers deeply -
   * a Champions League tie returns shots, fouls and corners - and nothing at
   * all for the rest, on the same account and plan. A single process-wide
   * switch was wrong twice over: one sweep through small leagues would turn
   * statistics off for the majors too, and nothing would turn them back on.
   *
   * So the giving up is per competition: after EMPTY_STATS_LIMIT empty
   * answers in a row from one league, and none that ever carried data, stop
   * asking for that league. Any answer with data clears the count.
   */
  private static readonly statsByLeague = new Map<string, { empty: number; ok: number }>();
  private static readonly EMPTY_STATS_LIMIT = 5;

  private static statsLeague(leagueId: string) {
    const seen = ApiFootballAdapter.statsByLeague.get(leagueId) ?? { empty: 0, ok: 0 };
    ApiFootballAdapter.statsByLeague.set(leagueId, seen);
    return seen;
  }

  /** Has this league answered with nothing often enough to stop asking? */
  static statisticsGivenUpFor(leagueId: string): boolean {
    const seen = ApiFootballAdapter.statsByLeague.get(leagueId);
    return Boolean(seen && seen.ok === 0 && seen.empty >= ApiFootballAdapter.EMPTY_STATS_LIMIT);
  }

  /** For the admin check and the sweep's log line. */
  static statisticsState() {
    const leagues = [...ApiFootballAdapter.statsByLeague.entries()];
    return {
      leaguesTried: leagues.length,
      leaguesWithStatistics: leagues.filter(([, v]) => v.ok > 0).length,
      leaguesGivenUp: leagues.filter(
        ([, v]) => v.ok === 0 && v.empty >= ApiFootballAdapter.EMPTY_STATS_LIMIT,
      ).length,
    };
  }

  static resetStatisticsState() {
    ApiFootballAdapter.statsByLeague.clear();
  }

  readonly name = 'api_football';
  private readonly logger = new Logger(ApiFootballAdapter.name);
  private readonly baseUrl: string;

  /**
   * Minimum gap between requests, process-wide. The adapter is a singleton,
   * so every ingest job shares one pace rather than each keeping its own.
   */
  private readonly minIntervalMs = Math.max(
    0,
    Number(process.env.API_FOOTBALL_MIN_INTERVAL_MS ?? 300),
  );
  private readonly maxRetries = 4;
  /** Base for exponential backoff on a 429 with no Retry-After. */
  private readonly retryBaseMs = Math.max(
    1,
    Number(process.env.API_FOOTBALL_RETRY_BASE_MS ?? 8000),
  );
  private lastRequestAt = 0;
  private slot: Promise<void> = Promise.resolve();
  private readonly apiKey: string;

  constructor(private readonly config: ConfigService) {
    this.baseUrl = config.get<string>('dataProviders.apiFootball.baseUrl')!;
    this.apiKey = config.get<string>('dataProviders.apiFootball.key') || '';
  }

  /** Wait for this request's turn. Serialised so concurrent jobs share the pace. */
  private pace(): Promise<void> {
    const turn = this.slot.then(async () => {
      const wait = this.lastRequestAt + this.minIntervalMs - Date.now();
      if (wait > 0) await sleep(wait);
      this.lastRequestAt = Date.now();
    });
    this.slot = turn.catch(() => undefined);
    return turn;
  }

  /**
   * The provider reports errors in the body, often with HTTP 200 — an empty
   * `errors` is `[]`, a populated one is an object keyed by kind. Reading only
   * the status meant a refused request came back as zero results and was
   * recorded as a successful run with nothing in it.
   */
  private bodyErrors(data: unknown): Record<string, string> | null {
    const errors = (data as { errors?: unknown })?.errors;
    if (!errors) return null;
    if (Array.isArray(errors)) return errors.length ? { error: String(errors[0]) } : null;
    if (typeof errors === 'object' && Object.keys(errors as object).length > 0) {
      return errors as Record<string, string>;
    }
    return null;
  }

  private async request<T>(endpoint: string, params: Record<string, string> = {}): Promise<T> {
    const url = new URL(`${this.baseUrl}/${endpoint}`);
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

    for (let attempt = 0; ; attempt++) {
      await this.pace();

      const response = await fetch(url.toString(), {
        headers: {
          'x-apisports-key': this.apiKey,
          'Content-Type': 'application/json',
        },
      });

      const text = await response.text();
      let data: unknown = null;
      try {
        data = JSON.parse(text);
      } catch {
        // non-JSON body; handled by the status checks below
      }
      const errors = this.bodyErrors(data);

      // Out for the day. Nothing to wait for — fail at once so the caller
      // stops instead of spending the rest of its run on refusals.
      if (errors?.requests) {
        this.logger.error(`API-Football daily allowance exhausted: ${errors.requests}`);
        throw new ApiFootballQuotaExhausted(errors.requests);
      }

      // Per-minute limit: wait and try again.
      const rateLimited = response.status === 429 || Boolean(errors?.rateLimit);
      if (rateLimited && attempt < this.maxRetries) {
        const header = Number(response.headers.get('retry-after'));
        const waitMs = Number.isFinite(header) && header > 0
          ? header * 1000
          : Math.min(60_000, this.retryBaseMs * 2 ** attempt);
        this.logger.warn(
          `API-Football rate limited on ${endpoint}; retry ${attempt + 1}/${this.maxRetries} in ${Math.round(waitMs / 1000)}s`,
        );
        await sleep(waitMs);
        continue;
      }

      if (!response.ok || errors) {
        const detail = errors ? JSON.stringify(errors) : text.slice(0, 300);
        this.logger.error(`API-Football ${endpoint} failed: ${response.status} — ${detail}`);
        throw new Error(`API-Football request failed: ${response.status}`);
      }

      const remaining = response.headers.get('x-ratelimit-requests-remaining');
      if (remaining && parseInt(remaining, 10) < 100) {
        this.logger.warn(`API-Football daily allowance low: ${remaining} requests remaining`);
      }

      return (data as { response: T }).response;
    }
  }

  async getFixtures(date: string, leagueId?: string): Promise<FixtureData[]> {
    const params: Record<string, string> = { date };
    if (leagueId) params.league = leagueId;

    const raw = await this.request<any[]>('fixtures', params);

    return raw.map((f) => this.mapFixture(f));
  }

  /** Shared fixture mapping — the /fixtures payload shape is the same everywhere it appears. */
  private mapFixture(f: any): FixtureData {
    return {
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
      htHomeScore: f.score?.halftime?.home ?? null,
      htAwayScore: f.score?.halftime?.away ?? null,
      ftHomeScore: f.score?.fulltime?.home ?? null,
      ftAwayScore: f.score?.fulltime?.away ?? null,
      league: {
        name: f.league.name,
        country: f.league.country,
        logoUrl: f.league.logo,
        season: f.league.season,
      },
      homeTeam: { name: f.teams.home.name, logoUrl: f.teams.home.logo },
      awayTeam: { name: f.teams.away.name, logoUrl: f.teams.away.logo },
    };
  }

  /**
   * Every fixture in a league-season, in ONE request.
   *
   * This is the cheapest history there is: a single call returns ~380 matches
   * with final scores, which is enough to settle every goals, result, BTTS and
   * handicap market in the registry. Backfilling by team instead would cost
   * hundreds of calls for the same data.
   */
  async getFixturesByLeagueSeason(
    leagueExternalId: string,
    season: number,
  ): Promise<FixtureData[]> {
    const raw = await this.request<any[]>('fixtures', {
      league: leagueExternalId,
      season: String(season),
    });

    return raw.map((f) => this.mapFixture(f));
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

  /**
   * Every competition the provider knows, not just those running in one
   * season.
   *
   * Resolving the target list against /leagues?season=2026 missed the Euros,
   * Copa America, AFCON and the World Cup qualifiers — none of them has a
   * 2026 season — so six competitions the client's audience bets heavily came
   * back unresolved. Without the season parameter the endpoint returns the
   * full catalogue in one request.
   */
  async getAllLeagues(): Promise<LeagueData[]> {
    const raw = await this.request<any[]>('leagues', {});

    return raw.map((l) => ({
      externalId: String(l.league.id),
      name: l.league.name,
      country: l.country?.name,
      countryCode: l.country?.code,
      logoUrl: l.league.logo,
      // The latest season the provider lists for it, for reference only.
      season: Number(
        (l.seasons ?? []).reduce(
          (latest: number, s: any) => Math.max(latest, Number(s.year) || 0),
          0,
        ),
      ),
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

  /**
   * Statistics for one team in one fixture. One request.
   *
   * Returns null when the provider has no statistics for that fixture, which
   * is common for lower divisions and older seasons — the caller records
   * nothing rather than inventing zeros.
   */
  async getFixtureStatistics(
    fixtureExternalId: string,
    teamExternalId: string,
  ): Promise<MatchStatsData | null> {
    const raw = await this.request<any[]>('fixtures/statistics', {
      fixture: fixtureExternalId,
      team: teamExternalId,
    });

    if (!raw?.length) return null;

    const s = raw[0];
    const getStat = (type: string) => {
      const found = s.statistics?.find((st: any) => st.type === type);
      return found?.value;
    };

    const parsePct = (v: unknown): number | undefined => {
      if (typeof v !== 'string') return undefined;
      const n = parseFloat(v.replace('%', ''));
      return Number.isFinite(n) ? n : undefined;
    };

    return {
      fixtureExternalId,
      teamExternalId,
      goals: 0, // scores live on the Event; stats endpoints do not carry them
      shotsTotal: getStat('Total Shots') ?? undefined,
      shotsOnTarget: getStat('Shots on Goal') ?? undefined,
      possession: parsePct(getStat('Ball Possession')),
      corners: getStat('Corner Kicks') ?? 0,
      yellowCards: getStat('Yellow Cards') ?? 0,
      redCards: getStat('Red Cards') ?? 0,
      fouls: getStat('Fouls') ?? undefined,
      offsides: getStat('Offsides') ?? undefined,
      saves: getStat('Goalkeeper Saves') ?? undefined,
      expectedGoals: parseFloat(getStat('expected_goals') ?? '') || undefined,
      passAccuracy: parsePct(getStat('Passes %')),
    };
  }

  /**
   * What the provider says about this account, and whether statistics come
   * back for a fixture we already hold.
   *
   * "Ingested 0 match stats" for every team says the statistics endpoint is
   * answering with nothing, but not why: the wrong plan, a league the
   * provider does not cover to that depth, a season outside the plan's
   * history, or the day's allowance already spent. /status is the account's
   * own answer, and one statistics call against a known finished fixture
   * settles the rest.
   */
  async diagnose(fixtureExternalId?: string): Promise<{
    account: unknown;
    statistics: {
      asked: boolean;
      fixtureExternalId: string | null;
      rows: number | null;
      sampleTypes: string[];
      error: string | null;
    };
    statisticsState: ReturnType<typeof ApiFootballAdapter.statisticsState>;
  }> {
    let account: unknown = null;
    try {
      const raw = await this.request<unknown>('status', {});
      account = raw;
    } catch (error) {
      account = { error: error instanceof Error ? error.message : 'unknown error' };
    }

    const statistics: {
      asked: boolean;
      fixtureExternalId: string | null;
      rows: number | null;
      sampleTypes: string[];
      error: string | null;
    } = {
      asked: Boolean(fixtureExternalId),
      fixtureExternalId: fixtureExternalId ?? null,
      rows: null,
      sampleTypes: [],
      error: null,
    };

    if (fixtureExternalId) {
      try {
        const raw = await this.request<any[]>('fixtures/statistics', {
          fixture: String(fixtureExternalId),
        });
        statistics.rows = raw.length;
        statistics.sampleTypes = (raw[0]?.statistics ?? [])
          .slice(0, 8)
          .map((st: any) => String(st.type));
      } catch (error) {
        statistics.error = error instanceof Error ? error.message : 'unknown error';
      }
    }

    return {
      account,
      statistics,
      statisticsState: ApiFootballAdapter.statisticsState(),
    };
  }

  async getMatchStats(teamExternalId: string, last = 10): Promise<MatchStatsData[]> {
    const matches = await this.getTeamRecentMatches(teamExternalId, last);
    return matches.map((m) => m.stats);
  }

  /**
   * Recent matches with their stats. One /fixtures call plus one
   * /fixtures/statistics call per fixture, so this costs `last + 1` requests
   * per team — the most expensive call in the ingest path.
   */
  async getTeamRecentMatches(teamExternalId: string, last = 10): Promise<TeamRecentMatch[]> {
    const raw = await this.request<any[]>('fixtures', {
      team: teamExternalId,
      last: String(last),
    });

    const matches: TeamRecentMatch[] = [];

    for (const fixture of raw) {
      // Per-fixture statistics are the expensive part: one request each, ten
      // per team. When the plan does not include them the endpoint answers
      // with an empty list every time, and a sweep of 40 teams spends ~400
      // requests to learn nothing. After EMPTY_STATS_LIMIT empty answers in a
      // row this stops asking for the rest of the process's life, so the
      // quota goes to fixtures and scores instead.
      const leagueId = String(fixture.league?.id ?? 'unknown');
      if (ApiFootballAdapter.statisticsGivenUpFor(leagueId)) continue;

      const fixtureStats = await this.request<any[]>('fixtures/statistics', {
        fixture: String(fixture.fixture.id),
        team: teamExternalId,
      });

      const seen = ApiFootballAdapter.statsLeague(leagueId);
      if (fixtureStats.length === 0) {
        seen.empty++;
        if (seen.ok === 0 && seen.empty === ApiFootballAdapter.EMPTY_STATS_LIMIT) {
          this.logger.warn(
            `No per-fixture statistics from league ${leagueId} after ${seen.empty} tries — ` +
              'the provider carries none for this competition. Corner and card markets will ' +
              'stay unsettled there; every other market, and every other league, is unaffected.',
          );
        }
      } else {
        seen.ok++;
        seen.empty = 0;
      }

      if (fixtureStats.length > 0) {
        const s = fixtureStats[0];
        const getStat = (type: string) => {
          const found = s.statistics?.find((st: any) => st.type === type);
          return found?.value;
        };

        const isHome = String(fixture.teams.home.id) === teamExternalId;
        const teamGoals = isHome ? fixture.goals.home : fixture.goals.away;

        matches.push({
          fixture: this.mapFixture(fixture),
          stats: {
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
          },
        });
      }
    }

    return matches;
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
        name: p.player.name,
        number: p.player.number ?? undefined,
        position: p.player.pos,
        gridPosition: p.player.grid,
      })),
      substitutes: (l.substitutes || []).map((p: any) => ({
        playerExternalId: String(p.player.id),
        name: p.player.name,
        number: p.player.number ?? undefined,
        position: p.player.pos,
      })),
    }));
  }

  /**
   * Who is missing THIS fixture, for both sides, in one request.
   *
   * The per-team endpoint returns every absence across the whole season, so
   * it cannot say who is out today. The per-fixture one can.
   */
  async getFixtureInjuries(fixtureExternalId: string): Promise<InjuryData[]> {
    const raw = await this.request<any[]>('injuries', { fixture: fixtureExternalId });

    return raw
      .filter((i) => i?.player?.id != null && i?.team?.id != null)
      .map((i) => ({
        playerExternalId: String(i.player.id),
        playerName: i.player.name,
        teamExternalId: String(i.team.id),
        type: i.player.type || 'Unknown',
        reason: i.player.reason,
        status: this.mapInjuryStatus(i.player.type),
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
