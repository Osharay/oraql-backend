import { Module } from '@nestjs/common';
import { ObservationsService } from './observations.service';
import { BaselinesService } from './baselines.service';
import { CandidatesService } from './candidates.service';
import { SnapshotsService } from './snapshots.service';
import { PerformanceService } from './performance.service';
import { ClustersService } from './clusters.service';
import { ProfilesService } from './profiles.service';
import { FormService } from './form.service';
import { StreaksScheduler } from './streaks.scheduler';
import { StreaksController } from './streaks.controller';

/**
 * V2 streak engine.
 *
 * observations -> baselines -> candidates (gated) -> snapshots -> settlement
 * -> performance, and the settled results feed the next round of baselines.
 */
@Module({
  controllers: [StreaksController],
  providers: [
    ObservationsService,
    BaselinesService,
    CandidatesService,
    SnapshotsService,
    PerformanceService,
    ClustersService,
    ProfilesService,
    FormService,
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
  ],
})
export class StreaksModule {}
