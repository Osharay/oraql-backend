import { Module } from '@nestjs/common';
import { ObservationsService } from './observations.service';
import { BaselinesService } from './baselines.service';
import { CandidatesService } from './candidates.service';
import { SnapshotsService } from './snapshots.service';
import { PerformanceService } from './performance.service';
import { ClustersService } from './clusters.service';
import { ProfilesService } from './profiles.service';
import { RatingsService } from './ratings.service';
import { SeasonRepairService } from './season-repair.service';
import { AvailabilityReader } from '@/modules/availability/availability.reader';
import { IngestModule } from '@/modules/ingest/ingest.module';
import { FormService } from './form.service';
import { EngineJobsService } from './engine-jobs.service';
import { BoardService } from './board.service';
import { StreaksScheduler } from './streaks.scheduler';
import { StreaksController } from './streaks.controller';

/**
 * V2 streak engine.
 *
 * observations -> baselines -> candidates (gated) -> snapshots -> settlement
 * -> performance, and the settled results feed the next round of baselines.
 */
@Module({
  imports: [IngestModule],
  controllers: [StreaksController],
  providers: [
    ObservationsService,
    BaselinesService,
    CandidatesService,
    SnapshotsService,
    PerformanceService,
    ClustersService,
    ProfilesService,
    RatingsService,
    SeasonRepairService,
    AvailabilityReader,
    FormService,
    BoardService,
    EngineJobsService,
    StreaksScheduler,
  ],
  exports: [
    ObservationsService,
    BaselinesService,
    CandidatesService,
    SnapshotsService,
    PerformanceService,
    ClustersService,
    ProfilesService,
    RatingsService,
  ],
})
export class StreaksModule {}
