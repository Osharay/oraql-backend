import { Module } from '@nestjs/common';
import { EventsService } from './events.service';
import { EventsController } from './events.controller';
import { EventsGateway } from './events.gateway';

@Module({
  controllers: [EventsController],
  providers: [EventsService, EventsGateway],
  exports: [EventsService, EventsGateway],
})
export class EventsModule {}
