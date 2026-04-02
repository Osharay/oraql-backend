import { Module } from '@nestjs/common';
import { ProbabilityService } from './probability.service';
import { ExplanationService } from './explanation.service';
import { MarketsModule } from '@/modules/markets/markets.module';
import { PicksModule } from '@/modules/picks/picks.module';
import { EventsModule } from '@/modules/events/events.module';

@Module({
  imports: [MarketsModule, PicksModule, EventsModule],
  providers: [ProbabilityService, ExplanationService],
  exports: [ProbabilityService],
})
export class ProbabilityModule {}
