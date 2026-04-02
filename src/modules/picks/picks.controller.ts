import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { PicksService } from './picks.service';
import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard';
import { Sport } from '@prisma/client';

@ApiTags('picks')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('picks')
export class PicksController {
  constructor(private readonly picksService: PicksService) {}

  @Get('top')
  @ApiOperation({ summary: "Get today's top Oracle Picks across all events" })
  @ApiQuery({ name: 'sport', enum: Sport, required: false })
  @ApiQuery({ name: 'minProbability', required: false, type: Number })
  @ApiQuery({ name: 'date', required: false })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async findTopPicks(
    @Query('sport') sport?: Sport,
    @Query('minProbability') minProbability?: number,
    @Query('date') date?: string,
    @Query('limit') limit?: number,
  ) {
    return this.picksService.findTopPicks({ sport, minProbability, date, limit });
  }

  @Get('event/:eventId')
  @ApiOperation({ summary: 'Get Oracle Picks for a specific event' })
  async findByEvent(@Param('eventId', ParseUUIDPipe) eventId: string) {
    return this.picksService.findByEvent(eventId);
  }
}
