import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '@/common/prisma/prisma.service';

@Injectable()
export class BuilderService {
  private readonly logger = new Logger(BuilderService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Get all selections for a user's Bet Builder.
   */
  async getSelections(userId: string) {
    const selections = await this.prisma.builderSelection.findMany({
      where: { userId },
      include: {
        market: {
          select: {
            id: true,
            name: true,
            shortName: true,
            category: true,
            probability: true,
            isValueBet: true,
            event: {
              select: {
                id: true,
                homeTeam: { select: { name: true, shortName: true, logoUrl: true } },
                awayTeam: { select: { name: true, shortName: true, logoUrl: true } },
                kickoffAt: true,
                status: true,
                league: { select: { name: true } },
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    // Compute combined probability (product of independent probabilities)
    const combinedProbability = selections.reduce(
      (acc, s) => acc * s.market.probability,
      1,
    );

    return {
      selections,
      count: selections.length,
      combinedProbability: Math.round(combinedProbability * 10000) / 10000,
    };
  }

  /**
   * Add a market to the Bet Builder.
   */
  async addSelection(userId: string, marketId: string) {
    // Verify market exists
    const market = await this.prisma.market.findUnique({
      where: { id: marketId },
      include: { event: { select: { id: true, status: true } } },
    });

    if (!market) {
      throw new NotFoundException(`Market ${marketId} not found`);
    }

    // Check for conflicting selections from the same event
    const existingFromEvent = await this.prisma.builderSelection.findFirst({
      where: {
        userId,
        market: { eventId: market.eventId },
      },
      include: { market: { select: { name: true, eventId: true } } },
    });

    // Allow multiple picks per event, but warn if same category
    if (existingFromEvent) {
      const existingMarket = await this.prisma.market.findUnique({
        where: { id: existingFromEvent.marketId },
      });
      if (existingMarket && existingMarket.category === market.category) {
        // Check for direct conflicts (e.g., Over 2.5 and Under 2.5)
        const isConflict =
          existingMarket.name.includes('Over') && market.name.includes('Under') &&
          existingMarket.line === market.line;
        if (isConflict) {
          throw new BadRequestException(
            `Conflicting selection: you already have "${existingMarket.name}" from this event`,
          );
        }
      }
    }

    return this.prisma.builderSelection.upsert({
      where: {
        userId_marketId: { userId, marketId },
      },
      create: {
        userId,
        marketId,
        addedProbability: market.probability,
      },
      update: {
        addedProbability: market.probability,
      },
      include: {
        market: {
          select: {
            id: true,
            name: true,
            shortName: true,
            category: true,
            probability: true,
          },
        },
      },
    });
  }

  /**
   * Remove a selection from the Bet Builder.
   */
  async removeSelection(userId: string, marketId: string) {
    const selection = await this.prisma.builderSelection.findUnique({
      where: { userId_marketId: { userId, marketId } },
    });

    if (!selection) {
      throw new NotFoundException('Selection not found in your builder');
    }

    await this.prisma.builderSelection.delete({
      where: { userId_marketId: { userId, marketId } },
    });

    return { removed: marketId };
  }

  /**
   * Clear all selections.
   */
  async clearSelections(userId: string) {
    const { count } = await this.prisma.builderSelection.deleteMany({
      where: { userId },
    });

    return { cleared: count };
  }

  /**
   * Export selections as a formatted text summary.
   */
  async exportSelections(userId: string) {
    const { selections, combinedProbability } = await this.getSelections(userId);

    if (selections.length === 0) {
      throw new BadRequestException('No selections to export');
    }

    const lines = selections.map((s, i) => {
      const event = s.market.event;
      const home = event.homeTeam.shortName || event.homeTeam.name;
      const away = event.awayTeam.shortName || event.awayTeam.name;
      const prob = (s.market.probability * 100).toFixed(1);
      return `${i + 1}. ${home} vs ${away} — ${s.market.name} (${prob}%)`;
    });

    const header = `Oracle Bet Builder — ${selections.length} selections`;
    const footer = `Combined probability: ${(combinedProbability * 100).toFixed(2)}%`;
    const exportText = [header, '─'.repeat(40), ...lines, '─'.repeat(40), footer].join('\n');

    return { text: exportText, selections: selections.length, combinedProbability };
  }
}
