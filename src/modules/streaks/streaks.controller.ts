import { Controller, Post, Get, Body, UseGuards, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard';
import { AdminGuard } from '@/common/guards/admin.guard';
import { ObservationsService } from './observations.service';
import { BaselinesService } from './baselines.service';
import { CandidatesService } from './candidates.service';
import { SnapshotsService } from './snapshots.service';
import { PerformanceService } from './performance.service';
import { ClustersService } from './clusters.service';
import { ProfilesService } from './profiles.service';

/**
 * Reads are open to any signed-in user — they are the product. Writes spend
 * API quota and rewrite shared state, so those carry AdminGuard individually.
 */
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
    private readonly clusters: ClustersService,
    private readonly profiles: ProfilesService,
  ) {}


  @Post('registry/sync')
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: 'Push the code market registry into the database' })
  async syncRegistry() {
    const count = await this.observations.syncRegistry();
    return { definitions: count };
  }

  @Post('observations/derive')
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: 'Derive observations for finished events that have none' })
  async derive(@Query('limit') limit?: string) {
    const parsed = Number(limit);
    return this.observations.deriveForFinishedEvents(
      Number.isFinite(parsed) && parsed > 0 ? parsed : 200,
    );
  }

  @Post('baselines/compute')
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: 'Recompute market baselines from settled observations' })
  async computeBaselines() {
    return this.baselines.computeAll();
  }

  @Post('engine/run')
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: 'Test every slice, correct for multiple comparisons, store candidates' })
  async runEngine() {
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
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: 'Capture pre-kickoff snapshots for upcoming events' })
  async capture() {
    return this.snapshots.captureForUpcoming();
  }

  @Post('snapshots/settle')
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: 'Settle snapshots whose events have finished' })
  async settle() {
    return this.snapshots.settleFinished();
  }

  @Post('clusters/build')
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: "Assemble today's clusters from captured snapshots" })
  async buildClusters(@Body() body?: { date?: string; size?: number; count?: number }) {
    return this.clusters.buildForDate(body ?? {});
  }

  @Get('clusters')
  @ApiOperation({ summary: 'Clusters for a date, with components and results' })
  async listClusters(@Query('date') date?: string) {
    return this.clusters.listForDate(date);
  }

  @Get('clusters/performance')
  @ApiOperation({ summary: 'Predicted versus actual cluster outcomes' })
  async clusterPerformance() {
    return this.clusters.performance();
  }

  @Post('profiles/compute')
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: 'Derive team-market WATCH / NEUTRAL / CAUTION flags' })
  async computeProfiles() {
    return this.profiles.computeAll();
  }

  @Get('profiles')
  @ApiOperation({ summary: 'Team-market profiles, highest lift first' })
  async listProfiles(@Query('flag') flag?: string, @Query('teamId') teamId?: string) {
    return this.profiles.list({
      flag: flag as never,
      teamId,
      limit: 100,
    });
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
  async listBaselines() {
    return this.baselines.listAll();
  }
}
