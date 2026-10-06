import { BadRequestException, Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard';
import { RecordService, ResultsScope } from './record.service';

const SCOPES: ResultsScope[] = ['all', 'club', 'international'];
const scopeOf = (s?: string): ResultsScope => (SCOPES.includes(s as ResultsScope) ? (s as ResultsScope) : 'all');

@ApiTags('record')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('record')
export class RecordController {
  constructor(private readonly record: RecordService) {}

  @Get('daily')
  @ApiOperation({ summary: 'Streaks and clusters given each day, landed against settled' })
  daily(@Query('days') days?: string, @Query('scope') scope?: string) {
    const d = Math.min(Math.max(Number(days) || 30, 1), 90);
    return this.record.daily(d, scopeOf(scope));
  }

  @Get('day')
  @ApiOperation({ summary: "One day's streaks (under their match) and clusters, with results" })
  async day(@Query('date') date?: string, @Query('scope') scope?: string) {
    const res = date ? await this.record.day(date, scopeOf(scope)) : null;
    if (!res) throw new BadRequestException('date must be YYYY-MM-DD');
    return res;
  }
}
