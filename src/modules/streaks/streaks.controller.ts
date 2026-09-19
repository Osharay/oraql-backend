import { Controller, Post, Get, ForbiddenException, UseGuards, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { UserRole } from '@prisma/client';
import { ObservationsService } from './observations.service';
import { BaselinesService } from './baselines.service';
import { CandidatesService } from './candidates.service';
import { SnapshotsService } from './snapshots.service';
import { PerformanceService } from './performance.service';

@ApiTags('streaks')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('streaks')
export class StreaksController {
  constructor(
    private readonly observations: ObservationsService,
    private readonly baselines: BaselinesService,
    private readonly candidates: CandidatesService,
    private readonly snapshots: SnapshotsService,
    private readonly performance: PerformanceService,
  ) {}

  private assertAdmin(user: { role?: UserRole }) {
    if (user?.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Admin role required');
    }
  }

  @Post('registry/sync')
  @ApiOperation({ summary: 'Push the code market registry into the database' })
  async syncRegistry(@CurrentUser() user: { role?: UserRole }) {
    this.assertAdmin(user);
    const count = await this.observations.syncRegistry();
    return { definitions: count };
  }

  @Post('observations/derive')
  @ApiOperation({ summary: 'Derive observations for finished events that have none' })
  async derive(
    @CurrentUser() user: { role?: UserRole },
    @Query('limit') limit?: string,
  ) {
    this.assertAdmin(user);
    const parsed = Number(limit);
    return this.observations.deriveForFinishedEvents(
      Number.isFinite(parsed) && parsed > 0 ? parsed : 200,
    );
  }

  @Post('baselines/compute')
  @ApiOperation({ summary: 'Recompute market baselines from settled observations' })
  async computeBaselines(@CurrentUser() user: { role?: UserRole }) {
    this.assertAdmin(user);
    return this.baselines.computeAll();
  }

  @Post('engine/run')
  @ApiOperation({ summary: 'Test every slice, correct for multiple comparisons, store candidates' })
  async runEngine(@CurrentUser() user: { role?: UserRole }) {
    this.assertAdmin(user);
    return this.candidates.runEngine();
  }

  @Get('candidates')
  @ApiOperation({
    summary: 'Latest run. tier=significant (default) cleared the gate; tier=suggestive did not',
  })
  async listCandidates(@Query('limit') limit?: string, @Query('tier') tier?: string) {
    const parsed = Number(limit);
    const take = Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 200) : 50;

    return tier === 'suggestive'
      ? this.candidates.getLatestSuggestive(take)
      : this.candidates.getLatestSurvivors(take);
  }

  @Post('snapshots/capture')
  @ApiOperation({ summary: 'Capture pre-kickoff snapshots for upcoming events' })
  async capture(@CurrentUser() user: { role?: UserRole }) {
    this.assertAdmin(user);
    return this.snapshots.captureForUpcoming();
  }

  @Post('snapshots/settle')
  @ApiOperation({ summary: 'Settle snapshots whose events have finished' })
  async settle(@CurrentUser() user: { role?: UserRole }) {
    this.assertAdmin(user);
    return this.snapshots.settleFinished();
  }

  @Get('performance')
  @ApiOperation({ summary: "A day's realised lift against expected" })
  async performance_(@Query('date') date?: string, @Query('all') all?: string) {
    return this.performance.dailyReport(date, all !== 'true');
  }

  @Get('spoilers')
  @ApiOperation({ summary: 'Streaks that broke, longest run first' })
  async spoilers(@Query('date') date?: string) {
    return this.performance.spoilers(date);
  }

  @Get('strength-bands')
  @ApiOperation({ summary: 'Does strength score actually predict realised lift?' })
  async strengthBands() {
    return this.performance.strengthBands();
  }

  @Get('sample-size-bands')
  @ApiOperation({ summary: 'Does more history actually produce more realised lift?' })
  async sampleSizeBands() {
    return this.performance.sampleSizeBands();
  }

  @Get('baselines')
  @ApiOperation({ summary: 'Current baselines, highest sample first' })
  async listBaselines(@CurrentUser() user: { role?: UserRole }) {
    this.assertAdmin(user);
    return this.baselines.listAll();
  }
}
