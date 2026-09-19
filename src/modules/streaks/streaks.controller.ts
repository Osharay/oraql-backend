import { Controller, Post, Get, ForbiddenException, UseGuards, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { UserRole } from '@prisma/client';
import { ObservationsService } from './observations.service';
import { BaselinesService } from './baselines.service';

@ApiTags('streaks')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('streaks')
export class StreaksController {
  constructor(
    private readonly observations: ObservationsService,
    private readonly baselines: BaselinesService,
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

  @Get('baselines')
  @ApiOperation({ summary: 'Current baselines, highest sample first' })
  async listBaselines(@CurrentUser() user: { role?: UserRole }) {
    this.assertAdmin(user);
    return this.baselines.listAll();
  }
}
