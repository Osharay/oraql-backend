import { Module } from '@nestjs/common';
import { ObservationsService } from './observations.service';
import { BaselinesService } from './baselines.service';
import { StreaksController } from './streaks.controller';

/**
 * V2 streak engine. Stage 1: the observation history and the baselines
 * computed from it. Candidate testing and snapshots build on these.
 */
@Module({
  controllers: [StreaksController],
  providers: [ObservationsService, BaselinesService],
  exports: [ObservationsService, BaselinesService],
})
export class StreaksModule {}
