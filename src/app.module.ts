import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { BullModule } from '@nestjs/bull';
import {
  appConfig,
  databaseConfig,
  redisConfig,
  jwtConfig,
  googleConfig,
  r2Config,
  dataProviderConfig,
  throttleConfig,
} from '@/config';
import { PrismaModule } from '@/common/prisma/prisma.module';
import { HealthModule } from '@/modules/health/health.module';
import { AuthModule } from '@/modules/auth/auth.module';
import { UsersModule } from '@/modules/users/users.module';
import { EventsModule } from '@/modules/events/events.module';
import { MarketsModule } from '@/modules/markets/markets.module';
import { PicksModule } from '@/modules/picks/picks.module';
import { BuilderModule } from '@/modules/builder/builder.module';
import { IngestModule } from '@/modules/ingest/ingest.module';
import { StreaksModule } from '@/modules/streaks/streaks.module';
import { ProbabilityModule } from '@/modules/probability/probability.module';
import { StorageModule } from '@/modules/storage/storage.module';

@Module({
  imports: [
    // ─── Global Config ───
    ConfigModule.forRoot({
      isGlobal: true,
      load: [
        appConfig,
        databaseConfig,
        redisConfig,
        jwtConfig,
        googleConfig,
        r2Config,
        dataProviderConfig,
        throttleConfig,
      ],
      envFilePath: ['.env.local', '.env'],
    }),

    // ─── Rate Limiting ───
    ThrottlerModule.forRootAsync({
      useFactory: () => ({
        throttlers: [
          {
            ttl: parseInt(process.env.THROTTLE_TTL || '60', 10) * 1000,
            limit: parseInt(process.env.THROTTLE_LIMIT || '100', 10),
          },
        ],
      }),
    }),

    // ─── Scheduling (Cron Jobs) ───
    ScheduleModule.forRoot(),

    // ─── Bull Queue (Redis-backed) ───
    BullModule.forRootAsync({
      useFactory: () => ({
        redis: {
          host: process.env.REDIS_HOST || 'localhost',
          port: parseInt(process.env.REDIS_PORT || '6379', 10),
          password: process.env.REDIS_PASSWORD || undefined,
        },
      }),
    }),

    // ─── Core Modules ───
    PrismaModule,
    HealthModule,

    // ─── Feature Modules ───
    AuthModule,
    UsersModule,
    EventsModule,
    MarketsModule,
    PicksModule,
    BuilderModule,
    IngestModule,
    StreaksModule,
    ProbabilityModule,
    StorageModule,
  ],
})
export class AppModule {}
