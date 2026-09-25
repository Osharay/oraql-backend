import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ObservationsService } from './observations.service';
import { BaselinesService } from './baselines.service';
import { CandidatesService } from './candidates.service';
import { SnapshotsService } from './snapshots.service';
import { ClustersService } from './clusters.service';
import { ProfilesService } from './profiles.service';

/**
 * The engine's daily rhythm.
 *
 * Order matters: observations must exist before baselines can be computed
 * from them, baselines before candidates can be tested against them, and
 * candidates before snapshots can be captured. Running these out of order
 * silently produces candidates judged against stale baselines.
 */
@Injectable()
export class StreaksScheduler {
  private readonly logger = new Logger(StreaksScheduler.name);

  /**
   * Set while the daily cycle runs. The half-hourly settlement and the hourly
   * capture both also fire at 05:30/06:00, when the cycle is doing the same
   * work over the same matches; running side by side they only compete for
   * the database. The cycle derives and captures anyway, so they stand down.
   */
  private cycleRunning = false;

  constructor(
    private readonly observations: ObservationsService,
    private readonly baselines: BaselinesService,
    private readonly candidates: CandidatesService,
    private readonly snapshots: SnapshotsService,
    private readonly clusters: ClustersService,
    private readonly profiles: ProfilesService,
  ) {}

  /** Keep the database registry in step with the code registry. */
  async onModuleInit() {
    try {
      await this.observations.syncRegistry();
    } catch (error) {
      this.logger.error(
        `Market registry sync failed on boot: ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  /**
   * Full engine cycle, after the 04:00 fixture ingest has landed.
   */
  @Cron('30 5 * * *', { name: 'streak-engine-cycle', timeZone: 'UTC' })
  async dailyCycle() {
    if (this.cycleRunning) {
      this.logger.warn('Streak engine cycle still running from before — skipping this one');
      return;
    }
    this.cycleRunning = true;
    this.logger.log('Streak engine cycle starting');

    try {
      // The daily run also tops up older matches with markets added since
      // they were derived; the half-hourly settlement run stays cheap.
      const derived = await this.observations.deriveForFinishedEvents(500, { refresh: true });
      const baselines = await this.baselines.computeAll();
      const run = await this.candidates.runEngine();
      const captured = await this.snapshots.captureForUpcoming();
      // Clusters build from snapshots, so they come after capture.
      const clusters = await this.clusters.buildForDate({});
      const profiles = await this.profiles.computeAll();

      this.logger.log(
        `Cycle complete — observations: ${derived.observations}, baselines: ${baselines.written}, ` +
          `tested: ${run.tested}, survived: ${run.surviving}, snapshots: ${captured.captured}, ` +
          `clusters: ${clusters.created}, profiles: ${profiles.written}`,
      );
    } catch (error) {
      this.logger.error(
        `Streak engine cycle failed: ${error instanceof Error ? error.message : error}`,
      );
    } finally {
      this.cycleRunning = false;
    }
  }

  /**
   * Capture hourly so events entering the 48h window are snapshotted while
   * there is still time before their cutoff.
   */
  @Cron('0 * * * *', { name: 'streak-snapshot-capture', timeZone: 'UTC' })
  async capture() {
    if (this.cycleRunning) {
      this.logger.debug('Snapshot capture skipped — the daily cycle is capturing');
      return;
    }
    try {
      await this.snapshots.captureForUpcoming();
    } catch (error) {
      this.logger.error(
        `Snapshot capture failed: ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  /**
   * Settle shortly after matches finish: derive the observations first, since
   * settlement reads them.
   */
  @Cron('*/30 * * * *', { name: 'streak-settlement', timeZone: 'UTC' })
  async settle() {
    if (this.cycleRunning) {
      this.logger.debug('Settlement skipped — the daily cycle is deriving the same matches');
      return;
    }
    try {
      await this.observations.deriveForFinishedEvents(200);
      await this.snapshots.settleFinished();
    } catch (error) {
      this.logger.error(
        `Settlement failed: ${error instanceof Error ? error.message : error}`,
      );
    }
  }
}
