import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard';
import { AdminGuard } from '@/common/guards/admin.guard';
import { IngestService } from './ingest.service';

/**
 * Admin-only ingest controls.
 *
 * The scheduled ingest runs at 04:00 UTC with no run on boot, which makes the
 * pipeline impossible to exercise during a working day. These endpoints kick
 * the same queue jobs the crons do — they add no new behaviour.
 */
@ApiTags('ingest')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('ingest')
export class IngestController {
  constructor(
    private readonly ingestService: IngestService,
    @InjectQueue('ingest') private readonly ingestQueue: Queue,
  ) {}


  @Post('run')
  @ApiOperation({ summary: 'Run the full ingest chain now (fixtures → stats → probabilities)' })
  async runNow() {
    const job = await this.ingestQueue.add('daily-fixtures', {}, { attempts: 1 });
    return { queued: 'daily-fixtures', jobId: job.id };
  }

  @Post('stats')
  @ApiOperation({ summary: 'Refresh match history for teams playing soon' })
  async runStats(
    @Body() body: { maxTeams?: number },
  ) {
    const job = await this.ingestQueue.add(
      'team-stats-sweep',
      { maxTeams: body?.maxTeams },
      { attempts: 1 },
    );
    return { queued: 'team-stats-sweep', jobId: job.id };
  }

  @Post('backfill')
  @ApiOperation({ summary: 'Backfill league-seasons — one request each, scores only' })
  async backfill(
    @Body() body: { leagues: string[]; seasons: number[] },
  ) {

    const leagues = body?.leagues ?? [];
    const seasons = body?.seasons ?? [];
    if (!leagues.length || !seasons.length) {
      return { error: 'Provide leagues (provider ids) and seasons' };
    }

    const results = [];
    for (const league of leagues) {
      for (const season of seasons) {
        results.push(await this.ingestService.backfillLeagueSeason(league, season));
      }
    }

    return {
      requests: results.length,
      fixtures: results.reduce((n, r) => n + r.fixtures, 0),
      finished: results.reduce((n, r) => n + r.finished, 0),
      results,
    };
  }

  @Post('backfill/stats')
  @ApiOperation({ summary: 'Backfill per-fixture stats — two requests per fixture, capped' })
  async backfillStats(
    @Body() body: { leagueExternalId?: string; season?: number; maxRequests?: number },
  ) {
    return this.ingestService.backfillMatchStats({
      leagueExternalId: body?.leagueExternalId,
      season: body?.season,
      maxRequests: body?.maxRequests ?? 100,
    });
  }

  @Post('backfill/estimate')
  @ApiOperation({ summary: 'What a backfill would cost, without spending anything' })
  async estimate(
    @Body() body: { leagues: string[]; seasons: number[] },
  ) {
    return this.ingestService.estimateBackfill(body?.leagues ?? [], body?.seasons ?? []);
  }

  @Post('compute')
  @ApiOperation({ summary: 'Recompute probabilities for events kicking off soon' })
  async runCompute() {
    const events = await this.ingestService.getEventsInWindow(72);
    for (const event of events) {
      await this.ingestQueue.add('compute-probabilities', { eventId: event.id }, { attempts: 1 });
    }
    return { queued: 'compute-probabilities', events: events.length };
  }
}
