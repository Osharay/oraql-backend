import { Controller, Post, Get, Body, UseGuards, Query, Param, HttpCode } from '@nestjs/common';
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
import { FormService, Venue } from './form.service';
import { BoardService } from './board.service';
import type { BoardSort } from './market-board';
import type { FormSort } from './form-summary';
import { EngineJob, EngineJobsService } from './engine-jobs.service';

/** What a background admin POST answers with; poll GET /streaks/jobs/:id. */
const BOARD_SORTS: BoardSort[] = ['probability', 'edge', 'confidence', 'run'];
const boardSort = (value?: string): BoardSort =>
  BOARD_SORTS.includes(value as BoardSort) ? (value as BoardSort) : 'probability';

const accepted = (job: EngineJob) => ({
  jobId: job.id,
  kind: job.kind,
  status: job.status,
  startedAt: job.startedAt,
});

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
    private readonly form: FormService,
    private readonly board: BoardService,
    private readonly jobs: EngineJobsService,
  ) {}

  @Get('jobs')
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: 'Recent background admin jobs, newest first' })
  listJobs() {
    return this.jobs.list();
  }

  @Get('jobs/:id')
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: 'One background job: running, done (with result) or failed (with error)' })
  getJob(@Param('id') id: string) {
    return this.jobs.get(id);
  }


  @Post('registry/sync')
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: 'Push the code market registry into the database' })
  async syncRegistry() {
    const count = await this.observations.syncRegistry();
    return { definitions: count };
  }

  @Post('observations/derive')
  @UseGuards(AdminGuard)
  @ApiOperation({
    summary:
      'Derive observations for every finished event that needs it (background job; poll /streaks/jobs/:id). ?limit=N does one batch.',
  })
  @HttpCode(202)
  derive(@Query('limit') limit?: string) {
    // With a limit, one batch (the old behaviour). Without, every finished
    // match that needs it, batch after batch, in the background.
    const parsed = Number(limit);
    const job = this.jobs.start('derive', (report) =>
      Number.isFinite(parsed) && parsed > 0
        ? this.observations.deriveForFinishedEvents(Math.min(parsed, 2000), { refresh: true })
        : this.observations.deriveAll({ onProgress: report }),
    );
    return accepted(job);
  }

  @Post('baselines/compute')
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: 'Recompute market baselines from settled observations' })
  @HttpCode(202)
  computeBaselines() {
    return accepted(this.jobs.start('baselines', () => this.baselines.computeAll()));
  }

  @Post('engine/run')
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: 'Test every slice, correct for multiple comparisons, store candidates' })
  @HttpCode(202)
  runEngine() {
    return accepted(this.jobs.start('engine', () => this.candidates.runEngine()));
  }

  @Get('board/event/:eventId')
  @ApiOperation({
    summary:
      'Every market in the registry estimated for one fixture, from both teams\' history at the venue they play it at',
  })
  async boardForEvent(
    @Param('eventId') eventId: string,
    @Query('sort') sort?: string,
    @Query('limit') limit?: string,
  ) {
    const parsed = Number(limit);
    return this.board.forEvent(eventId, {
      sort: boardSort(sort),
      limit: Number.isFinite(parsed) && parsed > 0 ? parsed : undefined,
    });
  }

  @Get('board')
  @ApiOperation({ summary: "The strongest rows from every fixture in the window" })
  async boardsForWindow(
    @Query('hours') hours?: string,
    @Query('perFixture') perFixture?: string,
    @Query('sort') sort?: string,
  ) {
    const h = Number(hours);
    const n = Number(perFixture);
    return this.board.forDate({
      hours: Number.isFinite(h) && h > 0 ? Math.min(h, 168) : undefined,
      perFixture: Number.isFinite(n) && n > 0 ? Math.min(n, 20) : undefined,
      sort: boardSort(sort),
    });
  }

  @Get('form/team/:teamId')
  @ApiOperation({
    summary:
      "A team's recent form across every market: the last N results, with the longer record and the market's usual rate beside them",
  })
  async teamForm(
    @Param('teamId') teamId: string,
    @Query('window') window?: string,
    @Query('venue') venue?: string,
    @Query('sort') sort?: string,
  ) {
    return this.form.teamForm(teamId, {
      window: Number(window) || undefined,
      venue: (['HOME', 'AWAY', 'ALL'].includes(String(venue)) ? venue : 'ALL') as Venue,
      sort: (['lift', 'rate', 'run'].includes(String(sort)) ? sort : 'lift') as FormSort,
    });
  }

  @Get('form/event/:eventId')
  @ApiOperation({ summary: 'Both sides of a fixture, each at the venue they play it at' })
  async fixtureForm(
    @Param('eventId') eventId: string,
    @Query('window') window?: string,
    @Query('sort') sort?: string,
  ) {
    return this.form.fixtureForm(eventId, {
      window: Number(window) || undefined,
      sort: (['lift', 'rate', 'run'].includes(String(sort)) ? sort : 'lift') as FormSort,
    });
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
  @HttpCode(202)
  capture() {
    return accepted(this.jobs.start('snapshots', () => this.snapshots.captureForUpcoming()));
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
  @HttpCode(202)
  buildClusters(@Body() body?: { date?: string; size?: number; count?: number }) {
    return accepted(this.jobs.start('clusters', () => this.clusters.buildForDate(body ?? {})));
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
  @HttpCode(202)
  computeProfiles() {
    return accepted(this.jobs.start('profiles', () => this.profiles.computeAll()));
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
