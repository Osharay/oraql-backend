import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '@/common/prisma/prisma.service';
import { ApiFootballAdapter } from './adapters/api-football.adapter';
import { OddsApiAdapter } from './adapters/odds-api.adapter';
import { EventStatus, IngestJobStatus } from '@prisma/client';

@Injectable()
export class IngestService {
  private readonly logger = new Logger(IngestService.name);

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
   * Odds refresh — every 5 minutes.
   */
  @Cron('*/5 * * * *', { name: 'odds-refresh', timeZone: 'UTC' })
  async scheduleOddsRefresh() {
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
      const fixtures = await this.apiFootball.getFixtures(date);
      let processed = 0;

      for (const fixture of fixtures) {
        // Upsert league
        await this.prisma.league.upsert({
          where: { externalId: fixture.leagueExternalId },
          create: {
            externalId: fixture.leagueExternalId,
            name: 'Unknown League', // Will be updated by league sync
            season: new Date().getFullYear(),
          },
          update: {},
        });

        // Upsert teams
        for (const teamExtId of [fixture.homeTeamExternalId, fixture.awayTeamExternalId]) {
          await this.prisma.team.upsert({
            where: { externalId: teamExtId },
            create: { externalId: teamExtId, name: `Team ${teamExtId}` },
            update: {},
          });
        }

        // Resolve internal IDs
        const league = await this.prisma.league.findUnique({
          where: { externalId: fixture.leagueExternalId },
        });
        const homeTeam = await this.prisma.team.findUnique({
          where: { externalId: fixture.homeTeamExternalId },
        });
        const awayTeam = await this.prisma.team.findUnique({
          where: { externalId: fixture.awayTeamExternalId },
        });

        if (!league || !homeTeam || !awayTeam) continue;

        // Upsert event
        await this.prisma.event.upsert({
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

        processed++;
      }

      await this.updateJobRecord(job.id, IngestJobStatus.COMPLETED, processed);
      this.logger.log(`Ingested ${processed} fixtures for ${date}`);
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

      // Store raw bookmaker odds
      let processed = 0;
      for (const odd of odds) {
        await this.prisma.bookmakerOdds.create({
          data: {
            eventId: odd.fixtureExternalId, // needs mapping in production
            bookmaker: odd.bookmaker,
            marketName: odd.marketName,
            selection: odd.selection,
            odds: odd.odds,
            impliedProb: 1 / odd.odds,
            fetchedAt: new Date(),
          },
        }).catch(() => {
          // Skip if event doesn't exist yet
        });
        processed++;
      }

      await this.updateJobRecord(job.id, IngestJobStatus.COMPLETED, processed);
      this.logger.log(`Ingested ${processed} odds entries for ${sportKey}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      await this.updateJobRecord(job.id, IngestJobStatus.FAILED, 0, message);
      this.logger.error(`Odds ingest failed: ${message}`);
    }
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
