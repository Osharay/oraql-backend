import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '@/common/prisma/prisma.service';
import { ApiFootballAdapter, ApiFootballQuotaExhausted } from './adapters/api-football.adapter';
import { OddsApiAdapter } from './adapters/odds-api.adapter';
import { EventStatus, IngestJobStatus, Prisma } from '@prisma/client';
import { FixtureData } from './interfaces/data-provider.interface';
import { compareCoverage, isWantedCompetition } from './league-quality';
import {
  trackedLeagueIds,
  oddsPollingEnabled,
  coverageBudget,
  coverageSeasons,
} from '@/config/app.config';

@Injectable()
export class IngestService {
  private readonly logger = new Logger(IngestService.name);

  /** Only refresh odds for events kicking off inside this window. */
  private readonly ODDS_WINDOW_HOURS = 6;

  constructor(
    private readonly prisma: PrismaService,
    private readonly apiFootball: ApiFootballAdapter,
    private readonly oddsApi: OddsApiAdapter,
    @InjectQueue('ingest') private readonly ingestQueue: Queue,
  ) {}

  /** Redis key for the admin's odds switch. */
  private static readonly ODDS_SWITCH_KEY = 'oraql:settings:odds-polling';

  /**
   * Whether odds polling is on, and who decided.
   *
   * An admin can flip it from Engine controls; that choice is kept in Redis,
   * which the queue already depends on, so no migration is needed. With no
   * admin choice recorded — or if Redis is unreachable or was cleared — the
   * ODDS_POLLING_ENABLED env var decides, and that defaults to off. Every
   * failure lands on "off", which spends nothing.
   */
  async getOddsPolling(): Promise<{ enabled: boolean; source: 'admin' | 'default' }> {
    try {
      const client = await this.ingestQueue.client;
      const stored = await client.get(IngestService.ODDS_SWITCH_KEY);
      if (stored === 'on' || stored === 'off') {
        return { enabled: stored === 'on', source: 'admin' };
      }
    } catch (error) {
      this.logger.warn(
        `Could not read the odds switch; using the default: ${error instanceof Error ? error.message : error}`,
      );
    }
    return { enabled: oddsPollingEnabled(), source: 'default' };
  }

  async setOddsPolling(enabled: boolean, by?: string) {
    const client = await this.ingestQueue.client;
    await client.set(IngestService.ODDS_SWITCH_KEY, enabled ? 'on' : 'off');
    this.logger.log(`Odds polling turned ${enabled ? 'ON' : 'OFF'}${by ? ` by ${by}` : ''}`);
    return this.getOddsPolling();
  }

  /**
   * Daily data refresh — runs at 04:00 UTC.
   * Pulls fixtures, stats, injuries for the next 7 days.
   */
  @Cron('0 4 * * *', { name: 'daily-ingest', timeZone: 'UTC' })
  async scheduleDailyIngest() {
    this.logger.log('Scheduling daily ingest job...');
    await this.ingestQueue.add('daily-fixtures', {}, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 30000 },
    });
  }

  /**
   * Odds refresh — every 30 minutes, and only when something is about to start.
   *
   * The Odds API bills one credit per market per region per call. At the old
   * cadence (every 5 minutes, 6 leagues x 3 markets x 2 regions, round the
   * clock) this cost roughly 311k credits a month. Polling half-hourly, in one
   * region, only when an event kicks off within ODDS_WINDOW_HOURS, brings it
   * to a fraction of that — and odds barely move outside that window anyway.
   */
  @Cron('*/30 * * * *', { name: 'odds-refresh', timeZone: 'UTC' })
  async scheduleOddsRefresh() {
    if (!(await this.getOddsPolling()).enabled) {
      this.logger.debug('Odds refresh skipped — odds polling is off');
      return;
    }

    const upcoming = await this.getEventsInWindow(this.ODDS_WINDOW_HOURS);

    if (upcoming.length === 0) {
      this.logger.debug('Odds refresh skipped — no events near kickoff');
      return;
    }

    await this.ingestQueue.add('odds-refresh', {}, {
      attempts: 2,
      backoff: { type: 'fixed', delay: 10000 },
    });
  }

  /**
   * Lineup poll — checks for lineups starting 90 minutes before each kickoff.
   */
  @Cron('*/10 * * * *', { name: 'lineup-poll', timeZone: 'UTC' })
  async scheduleLineupPolls() {
    const now = new Date();
    const ninetyMinFromNow = new Date(now.getTime() + 90 * 60 * 1000);

    // Find events kicking off in the next 90 minutes that don't have confirmed lineups
    const events = await this.prisma.event.findMany({
      where: {
        status: EventStatus.SCHEDULED,
        kickoffAt: { gte: now, lte: ninetyMinFromNow },
        lineupsConfirmedAt: null,
      },
      select: { id: true, externalId: true, kickoffAt: true },
    });

    for (const event of events) {
      await this.ingestQueue.add('lineup-check', {
        eventId: event.id,
        externalId: event.externalId,
      }, {
        attempts: 3,
        backoff: { type: 'exponential', delay: 15000 },
      });
    }

    if (events.length > 0) {
      this.logger.log(`Queued lineup checks for ${events.length} upcoming events`);
    }
  }

  /**
   * Pull and normalize fixtures for a date range.
   */
  async ingestFixtures(date: string) {
    const job = await this.createJobRecord('api_football', 'daily_fixtures');

    try {
      const all = await this.apiFootball.getFixtures(date);

      // Keep only the competitions we actually track. Everything downstream is
      // rate-limited per team, so a worldwide fixture list does not mean more
      // coverage — it means none of it is deep enough to use.
      const tracked = trackedLeagueIds();
      const inScope = tracked.length
        ? all.filter((f) => tracked.includes(String(f.leagueExternalId)))
        : all;

      // Age-group, youth and exhibition football: almost no history to
      // measure, barely priced anywhere, and every one that reaches the
      // engine adds a test every real finding then has to beat.
      const fixtures = inScope.filter((f) => isWantedCompetition(f.league?.name ?? ''));
      const dropped = inScope.length - fixtures.length;

      let processed = 0;

      for (const fixture of fixtures) {
        const event = await this.upsertFixture(fixture);
        if (event) processed++;
      }

      await this.updateJobRecord(job.id, IngestJobStatus.COMPLETED, processed);
      this.logger.log(
        `Ingested ${processed} fixtures for ${date}` +
          (tracked.length ? ` (${all.length - inScope.length} outside tracked leagues)` : '') +
          (dropped ? ` (${dropped} youth or friendly fixtures skipped)` : ''),
      );
      return processed;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      await this.updateJobRecord(job.id, IngestJobStatus.FAILED, 0, message);
      this.logger.error(`Fixture ingest failed for ${date}: ${message}`);
      throw error;
    }
  }

  /** Redis key marking a league-season as recently attempted. */
  private static coverageKey(league: string, season: number) {
    return `oraql:coverage:${league}:${season}`;
  }

  /**
   * League-seasons worth backfilling, judged from the fixtures actually
   * coming up.
   *
   * The engine can only measure a team it has history for, and history only
   * existed for six hand-listed competitions — so a fixture from anywhere else
   * was in the database with nothing behind it and could never produce a
   * streak. Rather than maintain that list by hand, this reads the leagues of
   * the upcoming fixtures and returns the ones whose stored history is thin.
   *
   * One provider request per league-season, so breadth here is cheap; the
   * budget is what keeps a first run from spending the day's quota at once.
   * A league-season that was attempted recently is left alone for a week,
   * which stops a competition the provider has no history for from being
   * requested again every single day.
   */
  async leagueSeasonsNeedingHistory(options: {
    days?: number;
    minFinished?: number;
    budget?: number;
    seasons?: number;
    ignoreCooldown?: boolean;
  } = {}): Promise<Array<{ leagueExternalId: string; season: number; name: string }>> {
    const days = options.days ?? 7;
    const minFinished = options.minFinished ?? 50;
    const budget = options.budget ?? coverageBudget();
    const seasonDepth = options.seasons ?? coverageSeasons();

    const now = new Date();
    const upcoming = await this.prisma.event.findMany({
      where: {
        kickoffAt: { gte: now, lte: new Date(now.getTime() + days * 86_400_000) },
        status: { in: [EventStatus.SCHEDULED, EventStatus.LINEUP_CONFIRMED] },
      },
      select: { leagueId: true, league: { select: { externalId: true, name: true, season: true } } },
    });

    if (upcoming.length === 0) return [];

    // How much settled history each of those leagues already has.
    const finished = await this.prisma.event.groupBy({
      by: ['leagueId'],
      where: {
        status: EventStatus.FINISHED,
        leagueId: { in: [...new Set(upcoming.map((e) => e.leagueId))] },
      },
      _count: { _all: true },
    });
    const finishedByLeague = new Map<string, number>(
      finished.map((f) => [f.leagueId, f._count._all]),
    );

    const leagues = new Map<
      string,
      { externalId: string; name: string; season: number; upcoming: number }
    >();
    for (const e of upcoming) {
      if ((finishedByLeague.get(e.leagueId) ?? 0) >= minFinished) continue;
      // Nothing we would not hold a fixture for is worth a backfill request.
      if (!isWantedCompetition(e.league.name)) continue;

      const seen = leagues.get(e.league.externalId);
      if (seen) {
        seen.upcoming++;
        continue;
      }
      leagues.set(e.league.externalId, {
        externalId: e.league.externalId,
        name: e.league.name,
        season: e.league.season,
        upcoming: 1,
      });
    }

    // Busiest serious competitions first: a budget of 100 requests should
    // reach the leagues with twenty fixtures this week before a cup tie in a
    // third division.
    const ordered = [...leagues.values()].sort((a, b) =>
      compareCoverage(
        { leagueExternalId: a.externalId, name: a.name, upcoming: a.upcoming },
        { leagueExternalId: b.externalId, name: b.name, upcoming: b.upcoming },
      ),
    );

    const wanted: Array<{ leagueExternalId: string; season: number; name: string }> = [];
    const client = options.ignoreCooldown ? null : await this.coverageRedis();

    for (const league of ordered) {
      for (let i = 0; i < seasonDepth; i++) {
        if (wanted.length >= budget) return wanted;
        const season = league.season - i;
        if (client) {
          const seen = await client.get(IngestService.coverageKey(league.externalId, season));
          if (seen) continue;
        }
        wanted.push({ leagueExternalId: league.externalId, season, name: league.name });
      }
    }

    return wanted;
  }

  /** Remember that a league-season was attempted, so it is not retried daily. */
  async markCoverageAttempted(leagueExternalId: string, season: number, days = 7) {
    const client = await this.coverageRedis();
    if (!client) return;
    try {
      await client.set(
        IngestService.coverageKey(leagueExternalId, season),
        new Date().toISOString(),
        'EX',
        days * 86_400,
      );
    } catch {
      // A missing cooldown only means the league-season is tried again sooner.
    }
  }

  private async coverageRedis() {
    try {
      return await this.ingestQueue.client;
    } catch {
      return null;
    }
  }

  /**
   * Is the Odds API key working? Free to ask, so it can be checked from the
   * admin page as often as needed.
   */
  async diagnoseOdds() {
    const [switchState, key] = await Promise.all([this.getOddsPolling(), this.oddsApi.diagnose()]);
    return {
      polling: switchState,
      key,
      nextStep: key.ok
        ? switchState.enabled
          ? 'Key works and polling is on. If odds still do not appear, the failure is event matching, not authentication.'
          : 'Key works. Turn odds polling on to start storing prices.'
        : key.keyPresent
          ? 'Replace ODDS_API_KEY on Railway with a current key from the-odds-api.com, then run this check again.'
          : 'Set ODDS_API_KEY on Railway, then run this check again.',
    };
  }

  /**
   * Ingest odds data from The Odds API and update implied probabilities.
   */
  async ingestOdds(sportKey = 'soccer_epl') {
    const job = await this.createJobRecord('odds_api', 'odds_refresh');

    try {
      const odds = await this.oddsApi.getOddsForSport(sportKey);

      // The Odds API issues its own event ids, so odds have to be resolved back
      // to our events by team name + kickoff window. Resolving once per odds
      // event rather than per outcome keeps this to a handful of queries.
      const resolved = new Map<string, string | null>();
      const byEvent = new Map<string, Prisma.BookmakerOddsCreateManyInput[]>();
      let unmatched = 0;
      const fetchedAt = new Date();

      for (const odd of odds) {
        if (!resolved.has(odd.fixtureExternalId)) {
          resolved.set(odd.fixtureExternalId, await this.resolveEventId(odd));
        }
        const eventId = resolved.get(odd.fixtureExternalId);

        if (!eventId) {
          unmatched++;
          continue;
        }

        const rows = byEvent.get(eventId) ?? [];
        rows.push({
          eventId,
          bookmaker: odd.bookmaker,
          marketName: odd.marketName,
          selection: odd.selection,
          odds: odd.odds,
          impliedProb: 1 / odd.odds,
          fetchedAt,
        });
        byEvent.set(eventId, rows);
      }

      // Replace each event's odds rather than appending. The table was
      // write-only: every refresh added a full set of rows per bookmaker,
      // market and selection, and nothing ever read or removed them — so it
      // grew every half hour for as long as the service ran. Only the latest
      // price is meaningful.
      let processed = 0;
      for (const [eventId, rows] of byEvent) {
        await this.prisma.$transaction([
          this.prisma.bookmakerOdds.deleteMany({ where: { eventId } }),
          this.prisma.bookmakerOdds.createMany({ data: rows }),
        ]);
        processed += rows.length;
      }

      if (unmatched > 0) {
        this.logger.warn(
          `${unmatched} odds records for ${sportKey} did not match a known event`,
        );
      }

      await this.updateJobRecord(job.id, IngestJobStatus.COMPLETED, processed);
      this.logger.log(`Ingested ${processed} odds entries for ${sportKey}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      await this.updateJobRecord(job.id, IngestJobStatus.FAILED, 0, message);
      this.logger.error(`Odds ingest failed: ${message}`);
    }
  }

  /**
   * Upsert a fixture and everything it depends on (league, both teams, event).
   *
   * Names come from the fixture payload, so an existing placeholder row is
   * corrected on the next run rather than being left as "Unknown League".
   */
  private async upsertFixture(fixture: FixtureData) {
    const leagueName = fixture.league?.name;
    const league = await this.prisma.league.upsert({
      where: { externalId: fixture.leagueExternalId },
      create: {
        externalId: fixture.leagueExternalId,
        name: leagueName ?? `League ${fixture.leagueExternalId}`,
        country: fixture.league?.country,
        logoUrl: fixture.league?.logoUrl,
        season: fixture.league?.season ?? new Date().getFullYear(),
      },
      update: leagueName
        ? {
            name: leagueName,
            country: fixture.league?.country,
            logoUrl: fixture.league?.logoUrl,
          }
        : {},
    });

    const teams = [
      { extId: fixture.homeTeamExternalId, meta: fixture.homeTeam },
      { extId: fixture.awayTeamExternalId, meta: fixture.awayTeam },
    ];

    const [homeTeam, awayTeam] = await Promise.all(
      teams.map(({ extId, meta }) =>
        this.prisma.team.upsert({
          where: { externalId: extId },
          create: {
            externalId: extId,
            name: meta?.name ?? `Team ${extId}`,
            shortName: meta?.shortName,
            logoUrl: meta?.logoUrl,
          },
          update: meta?.name
            ? { name: meta.name, shortName: meta.shortName, logoUrl: meta.logoUrl }
            : {},
        }),
      ),
    );

    if (!league || !homeTeam || !awayTeam) return null;

    return this.prisma.event.upsert({
      where: { externalId: fixture.externalId },
      create: {
        externalId: fixture.externalId,
        leagueId: league.id,
        homeTeamId: homeTeam.id,
        awayTeamId: awayTeam.id,
        kickoffAt: fixture.kickoffAt,
        venue: fixture.venue,
        round: fixture.round,
        status: fixture.status as EventStatus,
        homeScore: fixture.homeScore,
        awayScore: fixture.awayScore,
        htHomeScore: fixture.htHomeScore ?? null,
        htAwayScore: fixture.htAwayScore ?? null,
        ftHomeScore: fixture.ftHomeScore ?? null,
        ftAwayScore: fixture.ftAwayScore ?? null,
        lastDataSync: new Date(),
      },
      update: {
        status: fixture.status as EventStatus,
        homeScore: fixture.homeScore,
        awayScore: fixture.awayScore,
        // Only set when the payload carries them, so a later partial payload
        // cannot erase a half-time score that was already recorded.
        ...(fixture.htHomeScore != null && fixture.htAwayScore != null
          ? { htHomeScore: fixture.htHomeScore, htAwayScore: fixture.htAwayScore }
          : {}),
        ...(fixture.ftHomeScore != null && fixture.ftAwayScore != null
          ? { ftHomeScore: fixture.ftHomeScore, ftAwayScore: fixture.ftAwayScore }
          : {}),
        lastDataSync: new Date(),
      },
    });
  }

  /**
   * Pull a team's recent matches and persist their stats.
   *
   * The probability engine reads MatchStats and nothing was ever writing to it,
   * so every computation ran on default values. Costs `last + 1` provider
   * requests, hence the 24h freshness guard in shouldSyncTeamStats().
   */
  async ingestTeamHistory(teamExternalId: string, last = 10) {
    const job = await this.createJobRecord('api_football', 'team_stats');

    try {
      const matches = await this.apiFootball.getTeamRecentMatches(teamExternalId, last);
      let processed = 0;

      for (const { fixture, stats } of matches) {
        const event = await this.upsertFixture(fixture);
        if (!event) continue;

        const team = await this.prisma.team.findUnique({
          where: { externalId: stats.teamExternalId },
        });
        if (!team) continue;

        await this.prisma.matchStats.upsert({
          where: { eventId_teamId: { eventId: event.id, teamId: team.id } },
          create: {
            eventId: event.id,
            teamId: team.id,
            goals: stats.goals ?? 0,
            shotsTotal: stats.shotsTotal,
            shotsOnTarget: stats.shotsOnTarget,
            possession: stats.possession,
            corners: stats.corners ?? 0,
            yellowCards: stats.yellowCards ?? 0,
            redCards: stats.redCards ?? 0,
            fouls: stats.fouls,
            offsides: stats.offsides,
            saves: stats.saves,
            expectedGoals: stats.expectedGoals,
            passAccuracy: stats.passAccuracy,
          },
          update: {
            goals: stats.goals ?? 0,
            corners: stats.corners ?? 0,
            yellowCards: stats.yellowCards ?? 0,
            redCards: stats.redCards ?? 0,
          },
        });

        processed++;
      }

      await this.updateJobRecord(job.id, IngestJobStatus.COMPLETED, processed);
      this.logger.log(`Ingested ${processed} match stats for team ${teamExternalId}`);
      return processed;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      await this.updateJobRecord(job.id, IngestJobStatus.FAILED, 0, message);
      this.logger.error(`Team stats ingest failed for ${teamExternalId}: ${message}`);
      return 0;
    }
  }

  /**
   * Skip teams whose history we already refreshed in the last 24 hours.
   * Each sync costs ~11 provider requests, so this guard is what keeps a
   * full fixture list from burning the daily quota.
   */
  async shouldSyncTeamStats(teamId: string): Promise<boolean> {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recent = await this.prisma.matchStats.count({
      where: { teamId, createdAt: { gte: since } },
    });
    return recent === 0;
  }

  /**
   * Teams playing in the given window, as provider ids, de-duplicated.
   */
  async getTeamsNeedingStats(withinHours = 72): Promise<Array<{ id: string; externalId: string }>> {
    const events = await this.prisma.event.findMany({
      where: {
        kickoffAt: {
          gte: new Date(),
          lte: new Date(Date.now() + withinHours * 60 * 60 * 1000),
        },
        status: { in: [EventStatus.SCHEDULED, EventStatus.LINEUP_CONFIRMED] },
      },
      select: {
        homeTeam: { select: { id: true, externalId: true } },
        awayTeam: { select: { id: true, externalId: true } },
      },
    });

    const seen = new Map<string, { id: string; externalId: string }>();
    for (const e of events) {
      for (const t of [e.homeTeam, e.awayTeam]) {
        if (t?.externalId) seen.set(t.id, { id: t.id, externalId: t.externalId });
      }
    }
    return [...seen.values()];
  }

  /**
   * Events kicking off in the given window — used to gate odds polling and to
   * decide which events are worth recomputing.
   */
  /**
   * Events in the window whose BOTH teams have enough match history for the
   * probability engine to say anything. Without this the sweep queued a job
   * for every fixture in the window and the engine skipped nearly all of
   * them, one warning at a time.
   */
  async getEventsReadyForCompute(withinHours: number, minHistory = 3) {
    const events = await this.getEventsInWindow(withinHours);
    if (events.length === 0) return [];

    const withTeams = await this.prisma.event.findMany({
      where: { id: { in: events.map((e) => e.id) } },
      select: { id: true, homeTeamId: true, awayTeamId: true },
    });

    const teamIds = Array.from(
      new Set(withTeams.flatMap((e) => [e.homeTeamId, e.awayTeamId])),
    );

    const counts = await this.prisma.matchStats.groupBy({
      by: ['teamId'],
      where: { teamId: { in: teamIds } },
      _count: { _all: true },
    });

    const history = new Map<string, number>(
      counts.map((c) => [c.teamId, Number(c._count?._all ?? 0)]),
    );
    const ready = new Set(
      withTeams
        .filter(
          (e) =>
            (history.get(e.homeTeamId) ?? 0) >= minHistory &&
            (history.get(e.awayTeamId) ?? 0) >= minHistory,
        )
        .map((e) => e.id),
    );

    return events.filter((e) => ready.has(e.id));
  }

  async getEventsInWindow(withinHours: number) {
    return this.prisma.event.findMany({
      where: {
        kickoffAt: {
          gte: new Date(),
          lte: new Date(Date.now() + withinHours * 60 * 60 * 1000),
        },
        status: { in: [EventStatus.SCHEDULED, EventStatus.LINEUP_CONFIRMED] },
      },
      select: { id: true, externalId: true, kickoffAt: true },
      orderBy: { kickoffAt: 'asc' },
    });
  }

  /**
   * Match an odds record to an Event by team names within a kickoff window.
   *
   * Providers spell clubs differently ("Wolverhampton Wanderers" vs "Wolves"),
   * so this compares normalised names and accepts a containment match either
   * way. Anything ambiguous returns null and is skipped rather than guessed.
   */
  private async resolveEventId(odd: {
    homeTeamName?: string;
    awayTeamName?: string;
    commenceAt?: Date;
  }): Promise<string | null> {
    if (!odd.homeTeamName || !odd.awayTeamName || !odd.commenceAt) return null;

    const windowMs = 3 * 60 * 60 * 1000;
    const candidates = await this.prisma.event.findMany({
      where: {
        kickoffAt: {
          gte: new Date(odd.commenceAt.getTime() - windowMs),
          lte: new Date(odd.commenceAt.getTime() + windowMs),
        },
      },
      select: {
        id: true,
        homeTeam: { select: { name: true } },
        awayTeam: { select: { name: true } },
      },
    });

    const norm = (v: string) =>
      v
        .toLowerCase()
        .replace(/[^a-z0-9 ]/g, '')
        .replace(/\b(fc|afc|cf|sc|ac|calcio|club)\b/g, '')
        .replace(/\s+/g, ' ')
        .trim();

    const matches = (a: string, b: string) => {
      const x = norm(a);
      const y = norm(b);
      if (!x || !y) return false;
      return x === y || x.includes(y) || y.includes(x);
    };

    const hits = candidates.filter(
      (c) =>
        matches(c.homeTeam.name, odd.homeTeamName!) &&
        matches(c.awayTeam.name, odd.awayTeamName!),
    );

    // Exactly one match, or we do not guess.
    return hits.length === 1 ? hits[0].id : null;
  }

  /**
   * Backfill one league-season. One provider request, ~380 fixtures with
   * scores — enough to settle every goals, result, BTTS and handicap market.
   *
   * Corner and card markets need per-fixture statistics, which cost two
   * requests each; that is a separate, explicitly budgeted job.
   */
  async backfillLeagueSeason(leagueExternalId: string, season: number) {
    const job = await this.createJobRecord('api_football', 'backfill_league_season');

    try {
      const fixtures = await this.apiFootball.getFixturesByLeagueSeason(
        leagueExternalId,
        season,
      );

      let processed = 0;
      let finished = 0;

      for (const fixture of fixtures) {
        const event = await this.upsertFixture(fixture);
        if (!event) continue;
        processed++;
        if (event.status === EventStatus.FINISHED) finished++;
      }

      await this.updateJobRecord(job.id, IngestJobStatus.COMPLETED, processed);
      this.logger.log(
        `Backfilled league ${leagueExternalId} season ${season}: ${processed} fixtures, ${finished} finished`,
      );

      return { leagueExternalId, season, fixtures: processed, finished, requests: 1 };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      await this.updateJobRecord(job.id, IngestJobStatus.FAILED, 0, message);
      this.logger.error(
        `Backfill failed for league ${leagueExternalId} season ${season}: ${message}`,
      );
      // Out of requests for the day: every remaining league-season would be
      // refused too, so let the caller stop rather than work through them.
      if (error instanceof ApiFootballQuotaExhausted) throw error;
      return { leagueExternalId, season, fixtures: 0, finished: 0, requests: 1, error: message };
    }
  }

  /**
   * Per-fixture statistics for finished events that lack them.
   *
   * Two requests per fixture, so this is capped hard and defaults small. A
   * full season of one league is ~760 requests: a tenth of the Pro daily
   * allowance for one league-season of corner data.
   */
  async backfillMatchStats(options: {
    leagueExternalId?: string;
    season?: number;
    maxRequests?: number;
  }) {
    const maxRequests = Math.min(options.maxRequests ?? 100, 2000);
    const job = await this.createJobRecord('api_football', 'backfill_match_stats');

    try {
      const events = await this.prisma.event.findMany({
        where: {
          status: EventStatus.FINISHED,
          matchStats: { none: {} },
          ...(options.leagueExternalId
            ? { league: { externalId: options.leagueExternalId } }
            : {}),
          ...(options.season ? { league: { season: options.season } } : {}),
        },
        select: {
          id: true,
          externalId: true,
          homeTeam: { select: { id: true, externalId: true } },
          awayTeam: { select: { id: true, externalId: true } },
        },
        orderBy: { kickoffAt: 'desc' },
        take: Math.floor(maxRequests / 2),
      });

      let requests = 0;
      let written = 0;

      for (const event of events) {
        if (requests + 2 > maxRequests) break;

        for (const team of [event.homeTeam, event.awayTeam]) {
          const stats = await this.apiFootball.getFixtureStatistics(
            event.externalId,
            team.externalId,
          );
          requests++;

          if (!stats) continue;

          await this.prisma.matchStats.upsert({
            where: { eventId_teamId: { eventId: event.id, teamId: team.id } },
            create: {
              eventId: event.id,
              teamId: team.id,
              goals: stats.goals ?? 0,
              shotsTotal: stats.shotsTotal,
              shotsOnTarget: stats.shotsOnTarget,
              possession: stats.possession,
              corners: stats.corners ?? 0,
              yellowCards: stats.yellowCards ?? 0,
              redCards: stats.redCards ?? 0,
              fouls: stats.fouls,
              offsides: stats.offsides,
              saves: stats.saves,
              expectedGoals: stats.expectedGoals,
              passAccuracy: stats.passAccuracy,
            },
            update: {
              corners: stats.corners ?? 0,
              yellowCards: stats.yellowCards ?? 0,
              redCards: stats.redCards ?? 0,
            },
          });
          written++;
        }
      }

      await this.updateJobRecord(job.id, IngestJobStatus.COMPLETED, written);
      this.logger.log(
        `Stats backfill: ${written} rows from ${requests} requests across ${events.length} events`,
      );

      return { eventsConsidered: events.length, statsWritten: written, requests };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      await this.updateJobRecord(job.id, IngestJobStatus.FAILED, 0, message);
      this.logger.error(`Stats backfill failed: ${message}`);
      return { eventsConsidered: 0, statsWritten: 0, requests: 0, error: message };
    }
  }

  /**
   * What a backfill plan would cost, without spending anything.
   *
   * Goal-based markets are effectively free to backfill; corner and card
   * markets are not, and the difference is large enough to decide scope.
   */
  async estimateBackfill(leagueExternalIds: string[], seasons: number[]) {
    const combos = leagueExternalIds.length * seasons.length;
    const fixturesPerSeason = 380;

    const pendingStats = await this.prisma.event.count({
      where: { status: EventStatus.FINISHED, matchStats: { none: {} } },
    });

    return {
      leagueSeasons: combos,
      fixtureRequests: combos,
      approxFixtures: combos * fixturesPerSeason,
      marketsCoveredByFixturesAlone:
        'goals, result, BTTS, double chance, handicaps — about 20 of the 27 definitions',
      statsRequestsForFullCoverage: pendingStats * 2,
      statsNote:
        'Corner and card markets need two requests per fixture. Run backfillMatchStats with an explicit maxRequests rather than sweeping a season.',
    };
  }

  // ─── Helpers ───

  private async createJobRecord(provider: string, jobType: string) {
    return this.prisma.ingestJob.create({
      data: {
        provider,
        jobType,
        status: IngestJobStatus.RUNNING,
        startedAt: new Date(),
      },
    });
  }

  private async updateJobRecord(
    id: string,
    status: IngestJobStatus,
    recordsProcessed: number,
    errorMessage?: string,
  ) {
    return this.prisma.ingestJob.update({
      where: { id },
      data: {
        status,
        recordsProcessed,
        errorMessage,
        completedAt: new Date(),
      },
    });
  }
}
