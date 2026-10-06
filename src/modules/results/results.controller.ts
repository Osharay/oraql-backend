import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard';
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
  list(@Query('type') type?: string, @Query('hours') hours?: string, @Query('scope') scope?: string) {
    const t = TYPES.includes(type as ResultsType) ? (type as ResultsType) : 'picks';
    const s = SCOPES.includes(scope as ResultsScope) ? (scope as ResultsScope) : 'all';
    const h = Math.min(Math.max(Number(hours) || 24, 1), 24 * 90);
    return this.results.list(t, h, s);
  }
}
