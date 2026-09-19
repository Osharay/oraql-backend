import {
  Controller,
  Post,
  Body,
  ForbiddenException,
  UseGuards,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { UserRole } from '@prisma/client';
import { IngestService } from './ingest.service';

/**
 * Admin-only ingest controls.
 *
 * The scheduled ingest runs at 04:00 UTC with no run on boot, which makes the
 * pipeline impossible to exercise during a working day. These endpoints kick
 * the same queue jobs the crons do — they add no new behaviour.
 */
@ApiTags('ingest')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('ingest')
export class IngestController {
  constructor(
    private readonly ingestService: IngestService,
    @InjectQueue('ingest') private readonly ingestQueue: Queue,
  ) {}

  private assertAdmin(user: { role?: UserRole }) {
    if (user?.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Admin role required');
    }
  }

  @Post('run')
  @ApiOperation({ summary: 'Run the full ingest chain now (fixtures → stats → probabilities)' })
  async runNow(@CurrentUser() user: { role?: UserRole }) {
    this.assertAdmin(user);
    const job = await this.ingestQueue.add('daily-fixtures', {}, { attempts: 1 });
    return { queued: 'daily-fixtures', jobId: job.id };
  }

  @Post('stats')
  @ApiOperation({ summary: 'Refresh match history for teams playing soon' })
  async runStats(
    @CurrentUser() user: { role?: UserRole },
    @Body() body: { maxTeams?: number },
  ) {
    this.assertAdmin(user);
    const job = await this.ingestQueue.add(
      'team-stats-sweep',
      { maxTeams: body?.maxTeams },
      { attempts: 1 },
    );
    return { queued: 'team-stats-sweep', jobId: job.id };
  }

  @Post('compute')
  @ApiOperation({ summary: 'Recompute probabilities for events kicking off soon' })
  async runCompute(@CurrentUser() user: { role?: UserRole }) {
    this.assertAdmin(user);
    const events = await this.ingestService.getEventsInWindow(72);
    for (const event of events) {
      await this.ingestQueue.add('compute-probabilities', { eventId: event.id }, { attempts: 1 });
    }
    return { queued: 'compute-probabilities', events: events.length };
  }
}
