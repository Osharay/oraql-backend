import { Module } from '@nestjs/common';
import { PicksService } from './picks.service';
import { PicksController } from './picks.controller';

@Module({
  controllers: [PicksController],
  providers: [PicksService],
  exports: [PicksService],
})
export class PicksModule {}
