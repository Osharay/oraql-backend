import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { EventsService } from './events.service';
import { EventFilterDto } from './dto/event-filter.dto';
import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard';
import { Public } from '@/common/decorators/public.decorator';
import { Sport } from '@prisma/client';

@ApiTags('events')
@Controller('events')
export class EventsController {
  constructor(private readonly eventsService: EventsService) {}

  @Get()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get events for a date with filters (dashboard)' })
  async findByDate(@Query() filters: EventFilterDto) {
    return this.eventsService.findByDate(filters);
  }

  @Get('upcoming')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get upcoming events (next 24h)' })
  @ApiQuery({ name: 'sport', enum: Sport, required: false })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async findUpcoming(
    @Query('sport') sport?: Sport,
    @Query('limit') limit?: number,
  ) {
    return this.eventsService.findUpcoming(sport, limit);
  }

  @Get('live')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get currently live events' })
  @ApiQuery({ name: 'sport', enum: Sport, required: false })
  async findLive(@Query('sport') sport?: Sport) {
    return this.eventsService.findLive(sport);
  }

  @Get('sports-summary')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get event count per sport for a date' })
  @ApiQuery({ name: 'date', required: false, description: 'ISO date string' })
  async getSportSummary(@Query('date') date?: string) {
    return this.eventsService.getSportSummary(date);
  }

  @Get('leagues')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get leagues with events for a sport/date' })
  @ApiQuery({ name: 'sport', enum: Sport })
  @ApiQuery({ name: 'date', required: false })
  async getLeagues(
    @Query('sport') sport: Sport,
    @Query('date') date?: string,
  ) {
    return this.eventsService.getLeaguesForDate(sport, date);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get full event detail with markets, picks, lineups' })
  async findById(@Param('id', ParseUUIDPipe) id: string) {
    return this.eventsService.findById(id);
  }
}
