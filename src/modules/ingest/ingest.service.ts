import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '@/common/prisma/prisma.service';
import { ApiFootballAdapter, ApiFootballQuotaExhausted } from './adapters/api-football.adapter';
import { OddsApiAdapter } from './adapters/odds-api.adapter';
import { EventStatus, IngestJobStatus, Prisma } from '@prisma/client';
import { FixtureData } from './interfaces/data-provider.interface';
import { trackedLeagueIds, oddsPollingEnabled } from '@/config/app.config';

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
    if (!oddsPollingEnabled()) {
      this.logger.debug('Odds refresh skipped — ODDS_POLLING_ENABLED is not true');
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
      const fixtures = tracked.length
        ? all.filter((f) => tracked.includes(String(f.leagueExternalId)))
        : all;

      let processed = 0;

      for (const fixture of fixtures) {
        const event = await this.upsertFixture(fixture);
        if (event) processed++;
      }

      await this.updateJobRecord(job.id, IngestJobStatus.COMPLETED, processed);
      this.logger.log(
        `Ingested ${processed} fixtures for ${date}` +
          (tracked.length ? ` (${all.length - fixtures.length} outside tracked leagues)` : ''),
      );
      return processed;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      await this.updateJobRecord(job.id, IngestJobStatus.FAILED, 0, message);
      this.logger.error(`Fixture ingest failed for ${date}: ${message}`);
      throw error;
    }
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
        lastDataSync: new Date(),
      },
      update: {
        status: fixture.status as EventStatus,
        homeScore: fixture.homeScore,
        awayScore: fixture.awayScore,
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
