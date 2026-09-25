import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { IngestService } from './ingest.service';
import { IngestController } from './ingest.controller';
import { IngestProcessor } from './ingest.processor';
import { ApiFootballAdapter } from './adapters/api-football.adapter';
import { OddsApiAdapter } from './adapters/odds-api.adapter';
import { LineupsService } from './lineups.service';
import { MarketsModule } from '@/modules/markets/markets.module';
import { PicksModule } from '@/modules/picks/picks.module';
import { EventsModule } from '@/modules/events/events.module';
import { ProbabilityModule } from '@/modules/probability/probability.module';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'ingest' }),
    MarketsModule,
    PicksModule,
    EventsModule,
    ProbabilityModule,
  ],
  controllers: [IngestController],
  providers: [
    IngestService,
    IngestProcessor,
    LineupsService,
    ApiFootballAdapter,
    OddsApiAdapter,
  ],
  exports: [IngestService, ApiFootballAdapter, OddsApiAdapter],
})
export class IngestModule {}
