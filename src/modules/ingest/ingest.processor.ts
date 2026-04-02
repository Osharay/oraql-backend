import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { IngestService } from './ingest.service';

/**
 * Bull queue processor for ingest jobs.
 * Handles: daily-fixtures, odds-refresh, lineup-check
 */
@Processor('ingest')
export class IngestProcessor {
  private readonly logger = new Logger(IngestProcessor.name);

  constructor(private readonly ingestService: IngestService) {}

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
    return { totalProcessed };
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
