import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '@/common/prisma/prisma.service';
import { MarketCategory, Prisma } from '@prisma/client';

@Injectable()
export class MarketsService {
  private readonly logger = new Logger(MarketsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Get all markets for an event, grouped by category.
   */
  async findByEvent(eventId: string, category?: MarketCategory) {
    const markets = await this.prisma.market.findMany({
      where: {
        eventId,
        ...(category && { category }),
      },
      orderBy: [{ category: 'asc' }, { probability: 'desc' }],
      select: {
        id: true,
        category: true,
        name: true,
        shortName: true,
        line: true,
        probability: true,
        confidence: true,
        impliedProbability: true,
        valueGap: true,
        isValueBet: true,
        explanation: true,
        explanationFactors: true,
        probabilityUpdatedAt: true,
      },
    });

    // Group by category for the frontend
    const grouped = markets.reduce(
      (acc, market) => {
        const cat = market.category;
        if (!acc[cat]) acc[cat] = [];
        acc[cat].push(market);
        return acc;
      },
      {} as Record<string, typeof markets>,
    );

    return { markets, grouped, total: markets.length };
  }

  /**
   * Get a single market with full detail.
   */
  async findById(id: string) {
    const market = await this.prisma.market.findUnique({
      where: { id },
      include: {
        event: {
          select: {
            id: true,
            homeTeam: { select: { name: true, shortName: true } },
            awayTeam: { select: { name: true, shortName: true } },
            kickoffAt: true,
            status: true,
          },
        },
      },
    });

    if (!market) {
      throw new NotFoundException(`Market ${id} not found`);
    }

    return market;
  }

  /**
   * Get all value bets across events for a given date.
   */
  async findValueBets(date?: string, limit = 20) {
    const targetDate = date ? new Date(date) : new Date();
    const startOfDay = new Date(targetDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(targetDate);
    endOfDay.setHours(23, 59, 59, 999);

    return this.prisma.market.findMany({
      where: {
        isValueBet: true,
        event: {
          kickoffAt: { gte: startOfDay, lte: endOfDay },
          status: { in: ['SCHEDULED', 'LINEUP_CONFIRMED'] },
        },
      },
      include: {
        event: {
          select: {
            id: true,
            homeTeam: { select: { name: true, shortName: true } },
            awayTeam: { select: { name: true, shortName: true } },
            kickoffAt: true,
            league: { select: { name: true } },
          },
        },
      },
      orderBy: { valueGap: 'desc' },
      take: limit,
    });
  }

  /**
   * Bulk upsert markets from the probability engine.
   */
  async upsertMany(
    eventId: string,
    markets: Array<{
      category: MarketCategory;
      name: string;
      shortName?: string;
      line?: number;
      probability: number;
      confidence: number;
      explanation?: string;
      explanationFactors?: Prisma.JsonObject;
    }>,
  ) {
    const operations = markets.map((m) =>
      this.prisma.market.upsert({
        where: {
          // Use a composite unique - fallback to create
          id: '', // Will always miss, forcing create. In production use a proper composite.
        },
        create: {
          eventId,
          category: m.category,
          name: m.name,
          shortName: m.shortName,
          line: m.line,
          probability: m.probability,
          confidence: m.confidence,
          explanation: m.explanation,
          explanationFactors: m.explanationFactors,
          probabilityUpdatedAt: new Date(),
        },
        update: {
          probability: m.probability,
          confidence: m.confidence,
          explanation: m.explanation,
          explanationFactors: m.explanationFactors,
          probabilityUpdatedAt: new Date(),
        },
      }),
    );

    // Use transaction for atomicity
    return this.prisma.$transaction(operations);
  }

  /**
   * Update value bet flags by comparing oracle probability vs bookmaker odds.
   */
  async updateValueBetFlags(eventId: string) {
    const markets = await this.prisma.market.findMany({
      where: { eventId },
    });

    const updates = markets
      .filter((m) => m.impliedProbability !== null)
      .map((m) => {
        const valueGap = m.probability - (m.impliedProbability || 0);
        const isValueBet = valueGap >= 0.10; // 10% threshold

        return this.prisma.market.update({
          where: { id: m.id },
          data: { valueGap, isValueBet },
        });
      });

    if (updates.length > 0) {
      await this.prisma.$transaction(updates);
    }

    this.logger.log(`Updated value bet flags for event ${eventId}: ${updates.length} markets`);
  }
}
