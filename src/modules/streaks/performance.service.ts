import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@/common/prisma/prisma.service';
import { ObservationResult } from '@prisma/client';

/**
 * Performance reporting — whether any of this predicts anything.
 *
 * The number that matters is realised lift: observed hit rate minus what the
 * same markets do anyway. A raw hit rate of 81% is meaningless on its own,
 * because the selections might have produced 78% at random.
 */
@Injectable()
export class PerformanceService {
  private readonly logger = new Logger(PerformanceService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Daily report for everything that was actually shown to users.
   */
  async dailyReport(date?: string, displayedOnly = true) {
    const day = date ? new Date(date) : new Date();
    const start = new Date(day);
    start.setHours(0, 0, 0, 0);
    const end = new Date(day);
    end.setHours(23, 59, 59, 999);

    const snapshots = await this.prisma.streakSnapshot.findMany({
      where: {
        kickoffAt: { gte: start, lte: end },
        ...(displayedOnly ? { wasDisplayed: true } : {}),
      },
      select: {
        id: true,
        baselineRate: true,
        hitRate: true,
        strengthScore: true,
        result: { select: { result: true, realisedLift: true } },
      },
    });

    const settled = snapshots.filter((s) => s.result);
    const scored = settled.filter((s) => s.result!.result !== ObservationResult.VOID);
    const wins = scored.filter((s) => s.result!.result === ObservationResult.WIN).length;

    const observedRate = scored.length ? wins / scored.length : null;
    const expectedRate = scored.length
      ? scored.reduce((sum, s) => sum + s.baselineRate, 0) / scored.length
      : null;

    return {
      date: start.toISOString().slice(0, 10),
      selections: snapshots.length,
      settled: settled.length,
      pending: snapshots.length - settled.length,
      voided: settled.length - scored.length,
      wins,
      losses: scored.length - wins,
      observedRate,
      expectedRate,
      // The headline. Positive means the engine beat the base rates it was
      // judged against; near zero means it found nothing the market did not
      // already do on its own.
      realisedLift:
        observedRate != null && expectedRate != null ? observedRate - expectedRate : null,
    };
  }

  /**
   * Who spoilt it — the streaks that broke, longest run first.
   */
  async spoilers(date?: string, limit = 25) {
    const day = date ? new Date(date) : new Date();
    const start = new Date(day);
    start.setHours(0, 0, 0, 0);
    const end = new Date(day);
    end.setHours(23, 59, 59, 999);

    const broken = await this.prisma.snapshotResult.findMany({
      where: {
        result: ObservationResult.LOSS,
        snapshot: { kickoffAt: { gte: start, lte: end } },
      },
      select: {
        brokeStreakAtLength: true,
        realisedLift: true,
        snapshot: {
          select: {
            hitRate: true,
            baselineRate: true,
            sampleSize: true,
            strengthScore: true,
            wasDisplayed: true,
            event: {
              select: {
                kickoffAt: true,
                homeTeam: { select: { name: true } },
                awayTeam: { select: { name: true } },
              },
            },
            streakCandidate: {
              select: {
                marketDefinition: { select: { marketId: true, displayName: true } },
                selection: true,
              },
            },
          },
        },
      },
      orderBy: { brokeStreakAtLength: 'desc' },
      take: limit,
    });

    return broken.map((b) => ({
      fixture: `${b.snapshot.event.homeTeam.name} v ${b.snapshot.event.awayTeam.name}`,
      market: b.snapshot.streakCandidate.marketDefinition.displayName,
      selection: b.snapshot.streakCandidate.selection ?? 'ANY VENUE',
      streakBefore: b.brokeStreakAtLength,
      hitRate: b.snapshot.hitRate,
      baselineRate: b.snapshot.baselineRate,
      sampleSize: b.snapshot.sampleSize,
      strengthScore: b.snapshot.strengthScore,
      wasDisplayed: b.snapshot.wasDisplayed,
    }));
  }

  /**
   * Realised lift by sample size — the empirical answer to "how much history
   * is actually needed?".
   *
   * Rather than arguing about whether 10 matches is enough, this lets settled
   * results say so: if slices built on 20 observations show no realised lift
   * while slices built on 100 do, the floor is doing its job. If the small
   * ones perform just as well, the floor is too strict and can come down.
   */
  async sampleSizeBands() {
    const settled = await this.prisma.snapshotResult.findMany({
      where: { result: { in: [ObservationResult.WIN, ObservationResult.LOSS] } },
      select: {
        realisedLift: true,
        result: true,
        snapshot: { select: { sampleSize: true } },
      },
    });

    const bands = [
      { label: 'under 25', min: 0, max: 25 },
      { label: '25-49', min: 25, max: 50 },
      { label: '50-99', min: 50, max: 100 },
      { label: '100-199', min: 100, max: 200 },
      { label: '200+', min: 200, max: Number.MAX_SAFE_INTEGER },
    ];

    const rows = bands.map((b) => {
      const inBand = settled.filter(
        (s) => s.snapshot.sampleSize >= b.min && s.snapshot.sampleSize < b.max,
      );
      const wins = inBand.filter((s) => s.result === ObservationResult.WIN).length;

      return {
        band: b.label,
        settled: inBand.length,
        wins,
        hitRate: inBand.length ? wins / inBand.length : null,
        meanRealisedLift: inBand.length
          ? inBand.reduce((sum, s) => sum + (s.realisedLift ?? 0), 0) / inBand.length
          : null,
      };
    });

    return {
      totalSettled: settled.length,
      note:
        settled.length < 200
          ? `Only ${settled.length} settled snapshots. These bands cannot answer the sample-size question yet; a few hundred per band is the point at which they start to.`
          : 'Compare mean realised lift across bands. If the small-sample bands hold up, the floor can come down; if they do not, it is earning its place.',
      bands: rows,
    };
  }

  /**
   * Strength band versus realised lift — the analysis that decides whether the
   * scoring model is worth keeping.
   *
   * If high-strength candidates do not outperform medium-strength ones once a
   * few hundred snapshots have settled, the score is decoration and should be
   * rebuilt rather than polished.
   */
  async strengthBands() {
    const settled = await this.prisma.snapshotResult.findMany({
      where: { result: { in: [ObservationResult.WIN, ObservationResult.LOSS] } },
      select: {
        realisedLift: true,
        result: true,
        snapshot: { select: { strengthScore: true } },
      },
    });

    const bands = [
      { label: '0.00-0.25', min: 0, max: 0.25 },
      { label: '0.25-0.50', min: 0.25, max: 0.5 },
      { label: '0.50-0.75', min: 0.5, max: 0.75 },
      { label: '0.75-1.00', min: 0.75, max: 1.01 },
    ];

    const rows = bands.map((b) => {
      const inBand = settled.filter(
        (s) => s.snapshot.strengthScore >= b.min && s.snapshot.strengthScore < b.max,
      );
      const wins = inBand.filter((s) => s.result === ObservationResult.WIN).length;
      const lift = inBand.length
        ? inBand.reduce((sum, s) => sum + (s.realisedLift ?? 0), 0) / inBand.length
        : null;

      return {
        band: b.label,
        settled: inBand.length,
        wins,
        hitRate: inBand.length ? wins / inBand.length : null,
        meanRealisedLift: lift,
      };
    });

    const total = settled.length;
    return {
      totalSettled: total,
      note:
        total < 200
          ? `Only ${total} settled snapshots. Treat these bands as provisional; a few hundred are needed before the scoring model can be judged.`
          : 'Compare mean realised lift across bands: if it does not rise with strength, the scoring model is not working.',
      bands: rows,
    };
  }
}
