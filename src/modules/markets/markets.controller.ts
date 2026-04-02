import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { MarketsService } from './markets.service';
import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard';
import { MarketCategory } from '@prisma/client';

@ApiTags('markets')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('markets')
export class MarketsController {
  constructor(private readonly marketsService: MarketsService) {}

  @Get('event/:eventId')
  @ApiOperation({ summary: 'Get all markets for an event (grouped by category)' })
  @ApiQuery({ name: 'category', enum: MarketCategory, required: false })
  async findByEvent(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Query('category') category?: MarketCategory,
  ) {
    return this.marketsService.findByEvent(eventId, category);
  }

  @Get('value-bets')
  @ApiOperation({ summary: 'Get all value bets for a date' })
  @ApiQuery({ name: 'date', required: false })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async findValueBets(
    @Query('date') date?: string,
    @Query('limit') limit?: number,
  ) {
    return this.marketsService.findValueBets(date, limit);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single market with full detail' })
  async findById(@Param('id', ParseUUIDPipe) id: string) {
    return this.marketsService.findById(id);
  }
}
