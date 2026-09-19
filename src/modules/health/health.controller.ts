import { Controller, Get } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { PrismaService } from '@/common/prisma/prisma.service';
import { Public } from '@/common/decorators/public.decorator';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue('ingest') private readonly ingestQueue: Queue,
  ) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Health check' })
  async check() {
    let dbStatus = 'ok';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      dbStatus = 'error';
    }

    // Redis is checked explicitly because everything scheduled runs through
    // Bull: with the queue down, ingest and the streak engine silently do
    // nothing while the API still answers normally. A green database alone
    // says almost nothing about whether this service is working.
    let redisStatus = 'ok';
    let queueDepth: number | null = null;
    try {
      const client = await this.ingestQueue.client;
      const pong = await client.ping();
      if (pong !== 'PONG') redisStatus = 'error';
      queueDepth = await this.ingestQueue.getWaitingCount();
    } catch {
      redisStatus = 'error';
    }

    const healthy = dbStatus === 'ok' && redisStatus === 'ok';

    return {
      status: healthy ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version || '0.1.0',
      services: {
        database: dbStatus,
        redis: redisStatus,
      },
      queue: { waiting: queueDepth },
    };
  }
}
