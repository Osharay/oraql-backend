/**
 * Abstract data provider interface.
 * Every external sports data source implements this contract.
 * Allows swapping providers (API-Football, SportMonks, etc.) without modifying
 * the Ingest Worker or Probability Engine.
 */

export interface FixtureData {
  externalId: string;
  leagueExternalId: string;
  homeTeamExternalId: string;
  awayTeamExternalId: string;
  kickoffAt: Date;
  venue?: string;
  round?: string;
  status: string;
  homeScore?: number;
  awayScore?: number;
  /**
   * Half-time and full-time scores. The provider sends these in the same
   * fixture payload the backfill already downloads; they were being thrown
   * away, which left every half-time market impossible to settle.
   */
  htHomeScore?: number | null;
  htAwayScore?: number | null;
  ftHomeScore?: number | null;
  ftAwayScore?: number | null;

  /**
   * Names carried on the fixture payload itself. Providers return these
   * alongside the ids, so populating them here avoids separate league/team
   * sync calls and keeps records out of the "Unknown League" state.
   */
  league?: { name: string; country?: string; logoUrl?: string; season?: number };
  homeTeam?: { name: string; shortName?: string; logoUrl?: string };
  awayTeam?: { name: string; shortName?: string; logoUrl?: string };
}

export interface TeamData {
  externalId: string;
  name: string;
  shortName?: string;
  logoUrl?: string;
  country?: string;
  venueName?: string;
  venueCity?: string;
}

export interface LeagueData {
  externalId: string;
  name: string;
  country?: string;
  countryCode?: string;
  logoUrl?: string;
  season: number;
}

export interface MatchStatsData {
  fixtureExternalId: string;
  teamExternalId: string;
  goals: number;
  shotsTotal?: number;
  shotsOnTarget?: number;
  possession?: number;
  corners: number;
  yellowCards: number;
  redCards: number;
  fouls?: number;
  offsides?: number;
  saves?: number;
  expectedGoals?: number;
  passAccuracy?: number;
}

export interface PlayerData {
  externalId: string;
  name: string;
  position?: string;
  number?: number;
  photoUrl?: string;
  teamExternalId: string;
}

export interface LineupData {
  fixtureExternalId: string;
  teamExternalId: string;
  formation?: string;
  isConfirmed: boolean;
  starters: Array<{
    playerExternalId: string;
    name?: string;
    number?: number;
    position?: string;
    gridPosition?: string;
  }>;
  substitutes: Array<{
    playerExternalId: string;
    name?: string;
    number?: number;
    position?: string;
  }>;
}

export interface InjuryData {
  playerExternalId: string;
  /** Present from the per-fixture endpoint, so an unseen player can be created. */
  playerName?: string;
  teamExternalId: string;
  type: string;
  reason?: string;
  status: string; // "Out", "Doubtful", "Day-to-Day"
}

export interface OddsData {
  fixtureExternalId: string;
  bookmaker: string;
  marketName: string;
  selection: string;
  odds: number;

  /**
   * Odds providers use their own event ids, which never match the fixture
   * provider's. These three fields are what lets us resolve an odds record
   * back to an Event (team names + kickoff window).
   */
  homeTeamName?: string;
  awayTeamName?: string;
  commenceAt?: Date;
}

export interface TeamRecentMatch {
  fixture: FixtureData;
  stats: MatchStatsData;
}

/**
 * The contract every data provider adapter must implement.
 */
export interface IDataProvider {
  readonly name: string;

  /** Get fixtures for a date range */
  getFixtures(date: string, leagueId?: string): Promise<FixtureData[]>;

  /** Get leagues for a sport/season */
  getLeagues(season: number): Promise<LeagueData[]>;

  /** Every fixture in a league-season — the cheapest route to deep history. */
  getFixturesByLeagueSeason?(
    leagueExternalId: string,
    season: number,
  ): Promise<FixtureData[]>;

  /** Get teams for a league */
  getTeams(leagueExternalId: string, season: number): Promise<TeamData[]>;

  /** Get historical match stats for a team */
  getMatchStats(teamExternalId: string, last?: number): Promise<MatchStatsData[]>;

  /**
   * Recent matches for a team, with the fixture alongside its stats.
   * MatchStats rows need an Event to hang off, so the fixture has to come back
   * with them or the stats cannot be persisted.
   */
  getTeamRecentMatches?(
    teamExternalId: string,
    last?: number,
  ): Promise<TeamRecentMatch[]>;

  /** Get lineup for a fixture */
  getLineups(fixtureExternalId: string): Promise<LineupData[]>;

  /** Get injuries/suspensions for a team */
  getInjuries(teamExternalId: string): Promise<InjuryData[]>;

  /** Get players for a team */
  getPlayers(teamExternalId: string, season: number): Promise<PlayerData[]>;

  /** Get bookmaker odds for a fixture (optional — The Odds API handles this) */
  getOdds?(fixtureExternalId: string): Promise<OddsData[]>;
}
