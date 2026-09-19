import { Process, Processor } from '@nestjs/bull';
import { InjectQueue } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job, Queue } from 'bull';
import { IngestService } from './ingest.service';
import { ProbabilityService } from '@/modules/probability/probability.service';

/**
 * Bull queue processor for ingest jobs.
 * Handles: daily-fixtures, team-stats, compute-probabilities, odds-refresh, lineup-check
 */
@Processor('ingest')
export class IngestProcessor {
  private readonly logger = new Logger(IngestProcessor.name);

  constructor(
    private readonly ingestService: IngestService,
    private readonly probabilityService: ProbabilityService,
    @InjectQueue('ingest') private readonly ingestQueue: Queue,
  ) {}

  @Process('daily-fixtures')
  async handleDailyFixtures(job: Job) {
    this.logger.log('Processing daily fixtures ingest...');

    // Ingest fixtures for the next 7 days
    const dates: string[] = [];
    for (let i = 0; i < 7; i++) {
      const date = new Date();
      date.setDate(date.getDate() + i);
      dates.push(date.toISOString().split('T')[0]);
    }

    let totalProcessed = 0;
    for (const date of dates) {
      try {
        const count = await this.ingestService.ingestFixtures(date);
        totalProcessed += count;
        await job.progress(Math.round(((dates.indexOf(date) + 1) / dates.length) * 100));
      } catch (error) {
        this.logger.error(`Failed to ingest fixtures for ${date}`, error);
      }
    }

    this.logger.log(`Daily ingest complete: ${totalProcessed} fixtures across ${dates.length} days`);

    // Fixtures alone produce nothing a user can see: the probability engine
    // needs match history, and markets only exist once it has run. Queue both.
    await this.ingestQueue.add('team-stats-sweep', {}, { attempts: 2 });

    return { totalProcessed };
  }

  /**
   * Refresh match history for every team playing in the next 72 hours, then
   * queue probability computation for those events.
   *
   * Each team costs ~11 provider requests, so teams synced in the last 24h are
   * skipped and the sweep is capped per run.
   */
  @Process('team-stats-sweep')
  async handleTeamStatsSweep(job: Job<{ maxTeams?: number }>) {
    const maxTeams = job.data?.maxTeams ?? 40;
    const teams = await this.ingestService.getTeamsNeedingStats(72);

    let synced = 0;
    let skipped = 0;

    for (const team of teams) {
      if (synced >= maxTeams) {
        this.logger.warn(
          `Team stats sweep hit the ${maxTeams}-team cap; ${teams.length - synced - skipped} deferred to the next run`,
        );
        break;
      }

      if (!(await this.ingestService.shouldSyncTeamStats(team.id))) {
        skipped++;
        continue;
      }

      await this.ingestService.ingestTeamHistory(team.externalId, 10);
      synced++;
      await job.progress(Math.round((synced / Math.min(teams.length, maxTeams)) * 100));
    }

    this.logger.log(`Team stats sweep: ${synced} synced, ${skipped} still fresh`);

    // Now that history exists, compute probabilities for upcoming events.
    const events = await this.ingestService.getEventsInWindow(72);
    for (const event of events) {
      await this.ingestQueue.add(
        'compute-probabilities',
        { eventId: event.id },
        { attempts: 2, backoff: { type: 'fixed', delay: 5000 } },
      );
    }

    this.logger.log(`Queued probability computation for ${events.length} events`);
    return { synced, skipped, queued: events.length };
  }

  /**
   * Run the probability engine for one event.
   *
   * Nothing called computeForEvent before this, so no Market or Pick rows were
   * ever created and every user-facing list came back empty.
   */
  @Process('compute-probabilities')
  async handleComputeProbabilities(job: Job<{ eventId: string }>) {
    const { eventId } = job.data;
    await this.probabilityService.computeForEvent(eventId);
    return { eventId };
  }

  @Process('odds-refresh')
  async handleOddsRefresh(job: Job) {
    this.logger.log('Processing odds refresh...');

    const sportKeys = [
      'soccer_epl',
      'soccer_spain_la_liga',
      'soccer_germany_bundesliga',
      'soccer_italy_serie_a',
      'soccer_france_ligue_one',
      'soccer_uefa_champs_league',
    ];

    for (const sportKey of sportKeys) {
      try {
        await this.ingestService.ingestOdds(sportKey);
      } catch (error) {
        this.logger.error(`Odds refresh failed for ${sportKey}`, error);
      }
    }
  }

  @Process('lineup-check')
  async handleLineupCheck(job: Job<{ eventId: string; externalId: string }>) {
    this.logger.log(`Checking lineup for event ${job.data.eventId}...`);
    // Lineup check logic delegated to IngestService
    // On confirmation, triggers probability recomputation
  }
}
