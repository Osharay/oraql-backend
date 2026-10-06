import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { settlePick } from './pick-settlement';
import { PrismaService } from '@/common/prisma/prisma.service';
import { coveredLeagueFilter } from '@/common/covered-leagues';
import { EventStatus, ObservationResult, Sport } from '@prisma/client';
import { toFiniteNumber } from '@/common/utils/coerce';

@Injectable()
export class PicksService {
  private readonly logger = new Logger(PicksService.name);

  /**
   * Minimum probability threshold to qualify as an Oracle Pick.
   * Configurable — default 55%.
   */
  private readonly MIN_PROBABILITY = 0.55;
  private readonly MAX_PICKS_PER_EVENT = 5;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Settle the picks of finished matches, every half hour.
   *
   * Each pick is copied with its result into pick_results, so the Results page
   * keeps a record however the picks are regenerated later. Corners and cards
   * wait for statistics; after three days without them they are recorded as
   * unknown rather than retried for ever.
   */
  @Cron('10,40 * * * *', { name: 'picks-settlement', timeZone: 'UTC' })
  async scheduledSettlement() {
    try {
      await this.settleFinished();
    } catch (error) {
      this.logger.error(`Pick settlement failed: ${error instanceof Error ? error.message : error}`);
    }
  }

  async settleFinished(days = 14) {
    const now = Date.now();
    const events = await this.prisma.event.findMany({
      where: {
        status: EventStatus.FINISHED,
        kickoffAt: { gte: new Date(now - days * 86_400_000) },
        picks: { some: { isActive: true } },
      },
      select: {
        id: true,
        kickoffAt: true,
        homeTeamId: true,
        awayTeamId: true,
        ftHomeScore: true,
        ftAwayScore: true,
        homeScore: true,
        awayScore: true,
        homeTeam: { select: { name: true, shortName: true } },
        awayTeam: { select: { name: true, shortName: true } },
        matchStats: { select: { teamId: true, corners: true, yellowCards: true, redCards: true } },
        picks: {
          where: { isActive: true },
          select: { rank: true, probability: true, market: { select: { name: true, category: true } } },
        },
        pickResults: { select: { marketName: true } },
      },
      take: 2000,
    });

    let settled = 0;
    let waiting = 0;
    for (const e of events) {
      const done = new Set(e.pickResults.map((r) => r.marketName));
      const home = e.matchStats.find((m) => m.teamId === e.homeTeamId);
      const away = e.matchStats.find((m) => m.teamId === e.awayTeamId);
      const score = {
        homeGoals: e.ftHomeScore ?? e.homeScore,
        awayGoals: e.ftAwayScore ?? e.awayScore,
        homeCorners: home?.corners ?? null,
        awayCorners: away?.corners ?? null,
        homeCards: home ? home.yellowCards + home.redCards : null,
        awayCards: away ? away.yellowCards + away.redCards : null,
      };
      // The model names markets with short names where it has them.
      const teams = {
        home: e.homeTeam.shortName || e.homeTeam.name,
        away: e.awayTeam.shortName || e.awayTeam.name,
      };
      const stale = now - e.kickoffAt.getTime() > 3 * 86_400_000;

      for (const p of e.picks) {
        if (done.has(p.market.name)) continue;
        const result = settlePick(p.market.name, score, teams);
        if (result === 'UNKNOWN' && !stale) {
          waiting++;
          continue;
        }
        await this.prisma.pickResult.upsert({
          where: { eventId_marketName: { eventId: e.id, marketName: p.market.name } },
          create: {
            eventId: e.id,
            marketName: p.market.name,
            category: String(p.market.category),
            rank: p.rank,
            probability: p.probability,
            kickoffAt: e.kickoffAt,
            result: result as ObservationResult,
          },
          update: { result: result as ObservationResult, settledAt: new Date() },
        });
        settled++;
      }
    }

    if (settled) this.logger.log(`Picks settled: ${settled} (${waiting} waiting for statistics)`);
    return { settled, waiting };
  }

  /**
   * Get Oracle Picks for a single event.
   */
  async findByEvent(eventId: string) {
    return this.prisma.pick.findMany({
      where: { eventId, isActive: true },
      orderBy: { rank: 'asc' },
      include: {
        market: {
          select: {
            id: true,
            category: true,
            name: true,
            shortName: true,
            line: true,
            probability: true,
            confidence: true,
            isValueBet: true,
            valueGap: true,
            explanation: true,
            explanationFactors: true,
          },
        },
      },
    });
  }

  /**
   * Get today's top picks across all events — the "Top Picks Today" dashboard section.
   */
  async findTopPicks(filters: {
    sport?: Sport;
    minProbability?: number;
    date?: string;
    limit?: number;
  }) {
    const { sport, date } = filters;
    const minProbability = toFiniteNumber(filters.minProbability, this.MIN_PROBABILITY);
    const limit = toFiniteNumber(filters.limit, 20);

    const targetDate = date ? new Date(date) : new Date();
    const startOfDay = new Date(targetDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(targetDate);
    endOfDay.setHours(23, 59, 59, 999);

    const covered = await coveredLeagueFilter(this.prisma);
    return this.prisma.pick.findMany({
      where: {
        isActive: true,
        probability: { gte: minProbability },
        event: {
          kickoffAt: { gte: startOfDay, lte: endOfDay },
          status: { in: ['SCHEDULED', 'LINEUP_CONFIRMED'] },
          ...(sport && { sport }),
          ...(covered && { league: covered }),
        },
      },
      include: {
        event: {
          select: {
            id: true,
            homeTeam: { select: { name: true, shortName: true, logoUrl: true } },
            awayTeam: { select: { name: true, shortName: true, logoUrl: true } },
            kickoffAt: true,
            status: true,
            league: { select: { name: true, logoUrl: true } },
          },
        },
        market: {
          select: {
            id: true,
            category: true,
            name: true,
            shortName: true,
            probability: true,
            isValueBet: true,
          },
        },
      },
      orderBy: { probability: 'desc' },
      take: limit,
    });
  }

  /**
   * Generate/regenerate Oracle Picks for an event.
   * Called by the Probability Engine after computing market probabilities.
   */
  async generateForEvent(eventId: string) {
    // Replace the event's picks. They cannot merely be deactivated: rank is
    // unique per event, so a second set would collide with the first. (This
    // was hidden while recomputes deleted every market, and picks with them.)
    await this.prisma.pick.deleteMany({ where: { eventId } });

    // Get top markets by probability
    const topMarkets = await this.prisma.market.findMany({
      where: {
        eventId,
        origin: 'MODEL',
        probability: { gte: this.MIN_PROBABILITY },
      },
      orderBy: { probability: 'desc' },
      take: this.MAX_PICKS_PER_EVENT,
    });

    if (topMarkets.length === 0) {
      this.logger.log(`No markets above threshold for event ${eventId}`);
      return [];
    }

    // Create ranked picks
    const picks = await this.prisma.$transaction(
      topMarkets.map((market, index) =>
        this.prisma.pick.create({
          data: {
            eventId,
            marketId: market.id,
            rank: index + 1,
            probability: market.probability,
            confidence: market.confidence,
            explanation: market.explanation,
            isActive: true,
            computedAt: new Date(),
          },
        }),
      ),
    );

    this.logger.log(
      `Generated ${picks.length} picks for event ${eventId} (top: ${(topMarkets[0].probability * 100).toFixed(1)}%)`,
    );

    return picks;
  }
}
