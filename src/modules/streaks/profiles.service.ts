import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@/common/prisma/prisma.service';
import { ObservationResult, ProfileFlag } from '@prisma/client';
import { windowedVariance } from './stats.util';

/**
 * Team-market behaviour profiles.
 *
 * Always team AND market: a side can be highly consistent for one market and
 * meaningless for another, so a single "good team / bad team" label would be
 * wrong on its face.
 *
 * Entirely derived. There is no admin path to set a flag by hand, deliberately
 * — the moment a hunch can be typed in, the engine stops being measurable.
 *
 * CAUTION is a variance measure, not a character judgement. A team that broke
 * three streaks last month is usually a team that had a run near its true rate
 * after a run above it. High variance is a reason to want more evidence before
 * displaying, not a reason to distrust the team.
 */
@Injectable()
export class ProfilesService {
  private readonly logger = new Logger(ProfilesService.name);

  /** Below this, a team-market pairing has nothing to say. */
  private readonly MIN_SAMPLE = 30;

  /** Sustained lift over baseline to earn WATCH. */
  private readonly WATCH_LIFT = 0.08;

  /** Windowed variance above this earns CAUTION. */
  private readonly CAUTION_VARIANCE = 0.08;

  constructor(private readonly prisma: PrismaService) {}

  /** Teams per read. Keeps each result well under Node's string limit. */
  private readonly TEAM_CHUNK = 200;

  async computeAll(): Promise<{ written: number; watch: number; caution: number }> {
    const baselines = await this.prisma.marketBaseline.findMany({
      select: {
        marketDefinitionId: true,
        leagueId: true,
        season: true,
        baselineRate: true,
      },
    });

    const baselineMap = new Map<string, number>();
    for (const b of baselines) {
      baselineMap.set(
        `${b.marketDefinitionId}::${b.leagueId ?? 'GLOBAL'}::${b.season ?? 'GLOBAL'}`,
        b.baselineRate,
      );
    }

    let written = 0;
    let watch = 0;
    let caution = 0;

    // Read a few hundred teams at a time. Loading every settled observation in
    // one findMany (millions of rows) overflowed the engine's result string:
    // "Failed to convert rust String into napi string". Each chunk uses the
    // (teamId, marketDefinitionId, kickoffAt) index.
    const teams = await this.prisma.team.findMany({ select: { id: true }, orderBy: { id: 'asc' } });

    for (let i = 0; i < teams.length; i += this.TEAM_CHUNK) {
      const teamIds = teams.slice(i, i + this.TEAM_CHUNK).map((t: { id: string }) => t.id);
      const observations = await this.prisma.marketObservation.findMany({
        where: {
          result: { in: [ObservationResult.WIN, ObservationResult.LOSS] },
          teamId: { in: teamIds },
        },
        select: {
          teamId: true,
          marketDefinitionId: true,
          result: true,
          leagueId: true,
          season: true,
        },
        orderBy: { kickoffAt: 'desc' },
      });

      // team::market -> results, newest first (the query is already ordered)
      const grouped = new Map<
        string,
        { results: Array<'WIN' | 'LOSS'>; leagueId: string; season: number }
      >();

      for (const o of observations) {
        const key = `${o.teamId}::${o.marketDefinitionId}`;
        const entry = grouped.get(key) ?? {
          results: [] as Array<'WIN' | 'LOSS'>,
          leagueId: o.leagueId,
          season: o.season,
        };
        entry.results.push(o.result as 'WIN' | 'LOSS');
        grouped.set(key, entry);
      }

      for (const [key, entry] of grouped) {
        if (entry.results.length < this.MIN_SAMPLE) continue;

        const [teamId, marketDefinitionId] = key.split('::');
        const sampleSize = entry.results.length;
        const wins = entry.results.filter((r) => r === 'WIN').length;
        const hitRate = wins / sampleSize;

        const baselineRate =
          baselineMap.get(`${marketDefinitionId}::${entry.leagueId}::${entry.season}`) ??
          baselineMap.get(`${marketDefinitionId}::GLOBAL::GLOBAL`);

        // Without a baseline there is no lift, and a profile without lift is
        // just a hit rate wearing a badge.
        if (baselineRate == null) continue;

        const lift = hitRate - baselineRate;
        const variance = windowedVariance(entry.results, 5);

        let flag: ProfileFlag = ProfileFlag.NEUTRAL;
        if (variance != null && variance > this.CAUTION_VARIANCE) {
          flag = ProfileFlag.CAUTION;
        } else if (lift >= this.WATCH_LIFT) {
          flag = ProfileFlag.WATCH;
        }

        if (flag === ProfileFlag.WATCH) watch++;
        if (flag === ProfileFlag.CAUTION) caution++;

        await this.prisma.teamMarketProfile.upsert({
          where: { teamId_marketDefinitionId: { teamId, marketDefinitionId } },
          create: {
            teamId,
            marketDefinitionId,
            sampleSize,
            wins,
            hitRate,
            baselineRate,
            lift,
            variance,
            flag,
          },
          update: {
            sampleSize,
            wins,
            hitRate,
            baselineRate,
            lift,
            variance,
            flag,
            lastComputedAt: new Date(),
          },
        });

        written++;
      }
    }

    this.logger.log(
      `Team-market profiles: ${written} written (${watch} watch, ${caution} caution)`,
    );

    return { written, watch, caution };
  }

  /** Profiles, optionally filtered by flag or team. */
  async list(options?: { flag?: ProfileFlag; teamId?: string; limit?: number }) {
    return this.prisma.teamMarketProfile.findMany({
      where: {
        ...(options?.flag ? { flag: options.flag } : {}),
        ...(options?.teamId ? { teamId: options.teamId } : {}),
      },
      include: {
        team: { select: { name: true, shortName: true } },
        marketDefinition: { select: { marketId: true, displayName: true } },
      },
      orderBy: { lift: 'desc' },
      take: Math.min(options?.limit ?? 100, 500),
    });
  }
}
