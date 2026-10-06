import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard';
import { londonDayBounds } from '@/common/london-day';
import { ResultsScope, ResultsService, ResultsType } from './results.service';

const TYPES: ResultsType[] = ['picks', 'streaks', 'clusters'];
const SCOPES: ResultsScope[] = ['all', 'club', 'international'];

@ApiTags('results')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('results')
export class ResultsController {
  constructor(private readonly results: ResultsService) {}

  @Get()
  @ApiOperation({ summary: 'Finished matches: what OraQL picked and how each landed, with hit rates' })
  list(
    @Query('type') type?: string,
    @Query('hours') hours?: string,
    @Query('scope') scope?: string,
    @Query('date') date?: string,
  ) {
    const t = TYPES.includes(type as ResultsType) ? (type as ResultsType) : 'picks';
    const day = date ? londonDayBounds(date) : null;
    const h = Math.min(Math.max(Number(hours) || 24, 1), 24 * 90);
    const window = day
      ? { since: day.start, until: day.end }
      : { since: new Date(Date.now() - h * 3_600_000), until: new Date() };
    return this.results.list(t, window, scopeOf(scope));
  }

  @Get('daily')
  @ApiOperation({ summary: 'The record day by day: picks, streaks and clusters landed against settled' })
  daily(@Query('days') days?: string, @Query('scope') scope?: string) {
    const d = Math.min(Math.max(Number(days) || 30, 1), 90);
    return this.results.daily(d, scopeOf(scope));
  }
}

function scopeOf(scope?: string): ResultsScope {
  return SCOPES.includes(scope as ResultsScope) ? (scope as ResultsScope) : 'all';
}
