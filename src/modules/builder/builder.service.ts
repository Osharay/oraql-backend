import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '@/common/prisma/prisma.service';
import { describeMarket } from '@/common/market-copy';
import { EventStatus } from '@prisma/client';
import { combinedChance, conflictBetween } from './builder-math';
import { legProbability, legSide, modelMarketName } from './streak-leg';
import { MARKET_DEFINITIONS, marketScope } from '@/modules/streaks/market-definitions';
import { streakMarketLabel } from '@/common/market-copy';

/** Statuses a selection can still be added for: the match has not started. */
const OPEN_STATUSES: EventStatus[] = [EventStatus.SCHEDULED, EventStatus.LINEUP_CONFIRMED];

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
            origin: true,
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

    // A plain product only holds across different matches. Selections that
    // share a match move together (or imply each other), so for those the
    // answer is a range — see combinedChance.
    const chance = combinedChance(
      selections.map((s) => ({ eventId: s.market.event.id, probability: s.market.probability })),
    );

    return {
      selections,
      count: selections.length,
      /** Null when two or more selections share a match; use combinedRange then. */
      combinedProbability: chance.probability,
      combinedRange: { low: chance.low, high: chance.high },
      sharedMatches: chance.sharedMatches,
    };
  }

  /**
   * Add a streak or cluster selection to the Bet Builder.
   *
   * Uses the model's own market for the fixture when it publishes one, so the
   * builder's conflict checks and the model's chance apply; otherwise creates
   * a market row from the streak (origin STREAK, which recomputes leave
   * alone), carrying the streak's chance. Then adds it like any market.
   */
  async addStreakSelection(
    userId: string,
    input: { eventId: string; marketId: string; teamId?: string | null; probability?: number; source?: string },
  ) {
    const def = MARKET_DEFINITIONS.find((d) => d.marketId === input.marketId);
    if (!def) throw new BadRequestException(`Unknown market ${input.marketId}`);

    const event = await this.prisma.event.findUnique({
      where: { id: input.eventId },
      select: {
        id: true,
        homeTeamId: true,
        awayTeamId: true,
        homeTeam: { select: { name: true, shortName: true } },
        awayTeam: { select: { name: true, shortName: true } },
      },
    });
    if (!event) throw new NotFoundException('That match is no longer listed');

    const scope = marketScope(def.marketId);
    const side = legSide(scope, input.teamId, event);
    if (!side) throw new BadRequestException('That team is not playing in this match');
    // Kept with the selection, so a saved cluster says where each one came
    // from and can settle it from the streak's own market.
    const origin = { source: input.source ?? 'STREAK_EXPLORATORY', streakMarketId: def.marketId, streakSide: side };

    // The model names markets with short names where it has them.
    const short = {
      home: event.homeTeam.shortName || event.homeTeam.name,
      away: event.awayTeam.shortName || event.awayTeam.name,
    };
    const modelName = modelMarketName(def.marketId, side, short);
    if (modelName) {
      const model = await this.prisma.market.findFirst({
        where: { eventId: event.id, name: modelName, origin: 'MODEL' },
        select: { id: true },
      });
      if (model) return this.addSelection(userId, model.id, origin);
    }

    const teamName = side === 'HOME' ? event.homeTeam.name : side === 'AWAY' ? event.awayTeam.name : null;
    // The model's naming where there is one, so conflict checks still work.
    const name = modelName ?? streakMarketLabel(def.displayName, scope, teamName);
    const probability = legProbability(input.probability ?? 0.5);

    const existing = await this.prisma.market.findFirst({
      where: { eventId: event.id, name, origin: 'STREAK' },
      select: { id: true },
    });
    const market = existing
      ? await this.prisma.market.update({
          where: { id: existing.id },
          data: { probability, probabilityUpdatedAt: new Date() },
          select: { id: true },
        })
      : await this.prisma.market.create({
          data: {
            eventId: event.id,
            origin: 'STREAK',
            category: def.category,
            name,
            shortName: def.shortName ?? null,
            line: def.line ?? null,
            probability,
            confidence: 0.5,
            explanation: 'Added from a streak: the chance is the team record behind it, not the match model.',
          },
          select: { id: true },
        });

    return this.addSelection(userId, market.id, origin);
  }

  /**
   * Add a market to the Bet Builder.
   */
  async addSelection(
    userId: string,
    marketId: string,
    origin?: { source: string; streakMarketId: string; streakSide: string },
  ) {
    // Verify market exists
    const market = await this.prisma.market.findUnique({
      where: { id: marketId },
      include: { event: { select: { id: true, status: true, kickoffAt: true } } },
    });

    if (!market) {
      throw new NotFoundException(`Market ${marketId} not found`);
    }

    // Only matches that have not kicked off. A finished match's outcome is
    // known; a live one is priced on pre-match numbers that no longer apply.
    if (!OPEN_STATUSES.includes(market.event.status) || market.event.kickoffAt <= new Date()) {
      throw new BadRequestException('This match has already started, finished or been called off, so it can no longer be added');
    }

    // Every existing selection from the same match, not just the first, and
    // checked in both directions so the order they were added in is irrelevant.
    const sameMatch = await this.prisma.builderSelection.findMany({
      where: { userId, market: { eventId: market.eventId }, NOT: { marketId } },
      include: { market: { select: { name: true, shortName: true, category: true } } },
    });

    for (const existing of sameMatch) {
      const reason = conflictBetween(existing.market, market);
      if (reason) {
        throw new BadRequestException(
          `Conflicting selection: you already have "${existing.market.name}" from this match — ${reason}`,
        );
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
        ...(origin ?? {}),
      },
      update: {
        addedProbability: market.probability,
        ...(origin ?? {}),
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
    const { selections, combinedProbability, combinedRange, sharedMatches } =
      await this.getSelections(userId);

    if (selections.length === 0) {
      throw new BadRequestException('No selections to export');
    }

    // Two lines per selection: the fixture, then the outcome in full. Pasted
    // into a chat, a bare "Over 0.5 Goals" under two club names reads as
    // belonging to one of them.
    const lines = selections.flatMap((s, i) => {
      const event = s.market.event;
      const home = event.homeTeam.shortName || event.homeTeam.name;
      const away = event.awayTeam.shortName || event.awayTeam.name;
      const prob = (s.market.probability * 100).toFixed(1);
      return [
        `${i + 1}. ${home} v ${away}`,
        `   ${describeMarket(s.market.name, event)} — ${prob}% chance`,
      ];
    });

    const header = `OraQL Bet Builder — ${selections.length} selection${
      selections.length === 1 ? '' : 's'
    }`;
    const pct = (p: number) => `${(p * 100).toFixed(2)}%`;
    const footer = [
      combinedProbability != null
        ? `${pct(combinedProbability)} chance all ${selections.length} land,` +
          ' treating different matches as independent.'
        : `Between ${pct(combinedRange.low)} and ${pct(combinedRange.high)} chance all ${selections.length} land.` +
          ` ${sharedMatches === 1 ? 'One match holds' : `${sharedMatches} matches hold`} more than one selection,` +
          ' and selections from the same match move together, so no single figure is given.',
      'Estimates from historical data — not a guarantee.',
    ].join(' ');
    const exportText = [header, '─'.repeat(40), ...lines, '─'.repeat(40), footer].join('\n');

    return {
      text: exportText,
      selections: selections.length,
      combinedProbability,
      combinedRange,
    };
  }
}
