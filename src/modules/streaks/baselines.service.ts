import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@/common/prisma/prisma.service';
import { ObservationResult } from '@prisma/client';

/**
 * Baseline rates — the expected hit rate for a market, so a streak can be
 * judged on lift rather than on a raw percentage.
 *
 * Without this, "Team Over 0.5 — 11/12" looks like a discovery when it is
 * roughly what that market does anyway (~80%). Lift is what separates the
 * interesting from the ordinary.
 */
@Injectable()
export class BaselinesService {
  private readonly logger = new Logger(BaselinesService.name);

  /** Below this, a baseline is too thin to divide by. */
  private readonly MIN_BASELINE_SAMPLE = 50;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Recompute baselines from settled observations.
   *
   * Two levels are stored: per market per league per season, and a global
   * per-market fallback (leagueId null, season null) for leagues that do not
   * yet have enough history of their own.
   *
   * VOID and UNKNOWN never enter the denominator — a void bet is not a loss,
   * and missing data is not evidence.
   */
  async computeAll(): Promise<{ written: number; skipped: number }> {
    const grouped = await this.prisma.marketObservation.groupBy({
      by: ['marketDefinitionId', 'leagueId', 'season', 'result'],
      where: { result: { in: [ObservationResult.WIN, ObservationResult.LOSS] } },
      _count: { _all: true },
    });

    // marketDefinitionId -> leagueId|season -> { wins, total }
    const scoped = new Map<string, { wins: number; total: number }>();
    const global = new Map<string, { wins: number; total: number }>();

    for (const row of grouped) {
      const n = row._count._all;
      const scopedKey = `${row.marketDefinitionId}::${row.leagueId}::${row.season}`;

      const s = scoped.get(scopedKey) ?? { wins: 0, total: 0 };
      s.total += n;
      if (row.result === ObservationResult.WIN) s.wins += n;
      scoped.set(scopedKey, s);

      const g = global.get(row.marketDefinitionId) ?? { wins: 0, total: 0 };
      g.total += n;
      if (row.result === ObservationResult.WIN) g.wins += n;
      global.set(row.marketDefinitionId, g);
    }

    let written = 0;
    let skipped = 0;

    for (const [key, { wins, total }] of scoped) {
      const [marketDefinitionId, leagueId, seasonRaw] = key.split('::');
      if (total < this.MIN_BASELINE_SAMPLE) {
        skipped++;
        continue;
      }
      const season = Number(seasonRaw);
      await this.upsertBaseline(marketDefinitionId, leagueId, season, wins, total);
      written++;
    }

    for (const [marketDefinitionId, { wins, total }] of global) {
      if (total < this.MIN_BASELINE_SAMPLE) {
        skipped++;
        continue;
      }
      await this.upsertBaseline(marketDefinitionId, null, null, wins, total);
      written++;
    }

    this.logger.log(`Baselines: ${written} written, ${skipped} below the sample floor`);
    return { written, skipped };
  }

  private async upsertBaseline(
    marketDefinitionId: string,
    leagueId: string | null,
    season: number | null,
    wins: number,
    sampleSize: number,
  ) {
    const baselineRate = wins / sampleSize;
    const existing = await this.prisma.marketBaseline.findFirst({
      where: { marketDefinitionId, leagueId, season },
      select: { id: true },
    });

    if (existing) {
      await this.prisma.marketBaseline.update({
        where: { id: existing.id },
        data: { wins, sampleSize, baselineRate, computedAt: new Date() },
      });
      return;
    }

    await this.prisma.marketBaseline.create({
      data: { marketDefinitionId, leagueId, season, wins, sampleSize, baselineRate },
    });
  }

  /** Current baselines, most-evidenced first. */
  async listAll() {
    return this.prisma.marketBaseline.findMany({
      include: {
        marketDefinition: { select: { marketId: true, displayName: true, category: true } },
        league: { select: { name: true } },
      },
      orderBy: { sampleSize: 'desc' },
      take: 200,
    });
  }

  /**
   * Best available baseline for a market: the league-and-season figure when it
   * exists, otherwise the global one. Returns null when neither has enough
   * history — in which case the candidate must not be ranked, because there is
   * nothing to compare it against.
   */
  async getBaseline(
    marketDefinitionId: string,
    leagueId?: string,
    season?: number,
  ): Promise<number | null> {
    if (leagueId && season) {
      const scoped = await this.prisma.marketBaseline.findFirst({
        where: { marketDefinitionId, leagueId, season },
        select: { baselineRate: true },
      });
      if (scoped) return scoped.baselineRate;
    }

    const global = await this.prisma.marketBaseline.findFirst({
      where: { marketDefinitionId, leagueId: null, season: null },
      select: { baselineRate: true },
    });

    return global?.baselineRate ?? null;
  }
}
