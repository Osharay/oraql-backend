import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@/common/prisma/prisma.service';
import { Sport } from '@prisma/client';

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
    const {
      sport,
      minProbability = this.MIN_PROBABILITY,
      date,
      limit = 20,
    } = filters;

    const targetDate = date ? new Date(date) : new Date();
    const startOfDay = new Date(targetDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(targetDate);
    endOfDay.setHours(23, 59, 59, 999);

    return this.prisma.pick.findMany({
      where: {
        isActive: true,
        probability: { gte: minProbability },
        event: {
          kickoffAt: { gte: startOfDay, lte: endOfDay },
          status: { in: ['SCHEDULED', 'LINEUP_CONFIRMED'] },
          ...(sport && { sport }),
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
    // Deactivate existing picks
    await this.prisma.pick.updateMany({
      where: { eventId },
      data: { isActive: false },
    });

    // Get top markets by probability
    const topMarkets = await this.prisma.market.findMany({
      where: {
        eventId,
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
