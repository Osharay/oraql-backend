import { Process, Processor } from '@nestjs/bull';
import { InjectQueue } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job, Queue } from 'bull';
import { IngestService } from './ingest.service';
import { ApiFootballQuotaExhausted } from './adapters/api-football.adapter';
import { ProbabilityService } from '@/modules/probability/probability.service';
import { ApiFootballAdapter } from './adapters/api-football.adapter';
import { LineupsService } from './lineups.service';

/**
 * One sweep per hour, whoever asks. The daily chain and the admin button
 * both queue it, and two sweeps running side by side synced the same 40
 * teams twice — every provider request paid for twice over.
 */
const sweepJobId = () => `team-stats-sweep:${new Date().toISOString().slice(0, 13)}`;

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
    private readonly lineups: LineupsService,
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
    await this.ingestQueue.add(
      'team-stats-sweep',
      {},
      { attempts: 2, jobId: sweepJobId(), removeOnComplete: true },
    );

    // Fixtures arrive from every competition the provider covers, and a
    // fixture whose league has no history behind it can never produce a
    // streak. Widen the history to match what is actually being played.
    await this.ingestQueue.add(
      'coverage-backfill',
      {},
      {
        attempts: 1,
        jobId: `coverage-backfill:${new Date().toISOString().slice(0, 10)}`,
        removeOnComplete: true,
      },
    );

    return { totalProcessed };
  }

  /**
   * Widen history to cover the leagues actually being played.
   *
   * One provider request per league-season, so this is the cheapest coverage
   * there is: the six-league backfill cost 24 requests and produced 8,085
   * matches. Bounded by COVERAGE_MAX_REQUESTS a run and resumed on the next,
   * and it stops the moment the provider says the quota is gone.
   */
  @Process('coverage-backfill')
  async handleCoverageBackfill(job: Job<{ budget?: number; days?: number; minFinished?: number }>) {
    const wanted = await this.ingestService.leagueSeasonsNeedingHistory({
      budget: job.data?.budget,
      days: job.data?.days,
      minFinished: job.data?.minFinished,
    });

    if (wanted.length === 0) {
      this.logger.log('Coverage: every league with fixtures coming up already has history');
      return { covered: 0, fixtures: 0 };
    }

    this.logger.log(
      `Coverage: ${wanted.length} league-seasons to backfill (${
        new Set(wanted.map((w) => w.leagueExternalId)).size
      } competitions)`,
    );

    let covered = 0;
    let fixtures = 0;
    let finished = 0;
    let quotaStopped = false;

    for (const [i, target] of wanted.entries()) {
      try {
        const result = await this.ingestService.backfillLeagueSeason(
          target.leagueExternalId,
          target.season,
        );
        fixtures += result.fixtures;
        finished += result.finished;
        covered++;
      } catch (error) {
        if (error instanceof ApiFootballQuotaExhausted) {
          quotaStopped = true;
          break;
        }
        // One dead league-season must not stop the rest; it is marked below
        // either way, so it will not be retried tomorrow.
        this.logger.warn(
          `Coverage: league ${target.leagueExternalId} season ${target.season} failed — ` +
            (error instanceof Error ? error.message : 'unknown error'),
        );
      }

      // Attempted, whatever the outcome: a competition the provider has no
      // history for should not be asked again every day.
      await this.ingestService.markCoverageAttempted(target.leagueExternalId, target.season);
      await job.progress(Math.round(((i + 1) / wanted.length) * 100));
    }

    this.logger.log(
      `Coverage: ${covered} of ${wanted.length} league-seasons backfilled — ` +
        `${fixtures} fixtures, ${finished} finished` +
        (quotaStopped ? ' (stopped: provider quota exhausted)' : ''),
    );

    return { covered, attempted: wanted.length, fixtures, finished, quotaStopped };
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

    const stats = ApiFootballAdapter.statisticsState();
    this.logger.log(
      `Team stats sweep: ${synced} synced, ${skipped} still fresh — statistics from ` +
        `${stats.leaguesWithStatistics} of ${stats.leaguesTried} leagues tried, ` +
        `${stats.leaguesGivenUp} with none`,
    );

    // Now that history exists, compute probabilities — but only for events
    // whose teams actually have some. Queueing the rest produced one skip
    // warning per fixture and no markets.
    const events = await this.ingestService.getEventsReadyForCompute(72);
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
  /**
   * Seasons of fixtures for the chosen leagues. One provider request per
   * league-season, scores only.
   */
  @Process('backfill-history')
  async handleBackfill(job: Job<{ leagues: string[]; seasons: number[] }>) {
    const { leagues = [], seasons = [] } = job.data ?? {};
    const total = leagues.length * seasons.length;
    const results: Array<{ fixtures: number; finished: number; error?: string }> = [];
    let done = 0;
    let stoppedForQuota = false;

    outer: for (const league of leagues) {
      for (const season of seasons) {
        try {
          results.push(await this.ingestService.backfillLeagueSeason(league, season));
        } catch (error) {
          if (error instanceof ApiFootballQuotaExhausted) {
            stoppedForQuota = true;
            break outer;
          }
          throw error;
        }
        done++;
        await job.progress(Math.round((done / Math.max(total, 1)) * 100));
      }
    }

    const failed = results.filter((r) => r.error).length;
    const fixtures = results.reduce((n, r) => n + r.fixtures, 0);
    const finished = results.reduce((n, r) => n + r.finished, 0);
    const skipped = total - results.length;

    // Say what actually happened. This used to log "Backfill complete: 24
    // league-seasons, 0 fixtures" when all 24 had been refused.
    const summary =
      `Backfill: ${results.length - failed} of ${total} league-seasons succeeded, ` +
      `${failed} failed${skipped ? `, ${skipped} not attempted` : ''}` +
      `${stoppedForQuota ? ' (daily API allowance exhausted)' : ''} — ` +
      `${fixtures} fixtures, ${finished} finished`;

    if (failed > 0 || stoppedForQuota) this.logger.warn(summary);
    else this.logger.log(summary);

    // A run where nothing landed is a failure, and Bull should record it as one.
    if (results.length - failed === 0) {
      throw new Error(summary);
    }

    return { requests: results.length, fixtures, finished, failed, skipped, stoppedForQuota };
  }

  @Process('compute-probabilities')
  async handleComputeProbabilities(job: Job<{ eventId: string }>) {
    const { eventId } = job.data;
    await this.probabilityService.computeForEvent(eventId);
    return { eventId };
  }

  @Process('odds-refresh')
  async handleOddsRefresh(job: Job) {
    // Checked here as well as in the cron, so a job queued before the switch
    // was turned off, or added by hand, still spends nothing.
    if (!(await this.ingestService.getOddsPolling()).enabled) {
      this.logger.log('Odds refresh skipped — odds polling is off');
      return { skipped: true };
    }

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
    const result = await this.lineups.check(job.data.eventId);

    // Recompute once, on the poll that confirms: the model now knows who is
    // missing, and confidence rises because the lineups are known. Markets
    // are updated in place, so builder selections on them survive.
    if (result.confirmed && !result.skipped) {
      await this.probabilityService.computeForEvent(job.data.eventId);
    }

    return result;
  }
}
