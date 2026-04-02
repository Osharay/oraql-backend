import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@/common/prisma/prisma.service';
import { MarketsService } from '@/modules/markets/markets.service';
import { PicksService } from '@/modules/picks/picks.service';
import { EventsGateway } from '@/modules/events/events.gateway';
import { ExplanationService } from './explanation.service';
import { MarketCategory, Prisma } from '@prisma/client';

/**
 * Core Probability Engine.
 *
 * Computes market probabilities based on:
 * 1. Historical match stats (last 5-10 matches per team)
 * 2. Player availability (injuries, suspensions)
 * 3. Match context (home/away, league position, importance)
 *
 * Model: Weighted frequency analysis with contextual adjustments.
 */
@Injectable()
export class ProbabilityService {
  private readonly logger = new Logger(ProbabilityService.name);

  /** Number of recent matches to analyze per team */
  private readonly MATCH_WINDOW = 10;

  /** Recency weighting: most recent match gets this multiplier vs oldest */
  private readonly RECENCY_WEIGHT_MAX = 2.0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly marketsService: MarketsService,
    private readonly picksService: PicksService,
    private readonly eventsGateway: EventsGateway,
    private readonly explanationService: ExplanationService,
  ) {}

  /**
   * Compute all market probabilities for an event.
   * This is the main entry point called after data ingestion.
   */
  async computeForEvent(eventId: string) {
    this.logger.log(`Computing probabilities for event ${eventId}`);

    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      include: {
        homeTeam: true,
        awayTeam: true,
        lineups: {
          include: { entries: { include: { player: true } } },
        },
      },
    });

    if (!event) {
      this.logger.warn(`Event ${eventId} not found, skipping`);
      return;
    }

    // Fetch historical stats for both teams
    const [homeStats, awayStats] = await Promise.all([
      this.getTeamHistory(event.homeTeamId),
      this.getTeamHistory(event.awayTeamId),
    ]);

    // Fetch injuries for both teams
    const [homeInjuries, awayInjuries] = await Promise.all([
      this.getTeamInjuries(event.homeTeamId),
      this.getTeamInjuries(event.awayTeamId),
    ]);

    // Check if lineups are confirmed
    const hasLineups = event.lineups.some((l) => l.isConfirmed);

    // ─── Compute each market category ───
    const markets: Array<{
      category: MarketCategory;
      name: string;
      shortName: string;
      line?: number;
      probability: number;
      confidence: number;
      explanation: string;
      explanationFactors: Prisma.JsonObject;
    }> = [];

    // Match Result (1X2)
    const matchResult = this.computeMatchResult(homeStats, awayStats, homeInjuries, awayInjuries);
    markets.push(...matchResult);

    // Goals Markets
    const goalsMarkets = this.computeGoalsMarkets(homeStats, awayStats);
    markets.push(...goalsMarkets);

    // Corners Markets
    const cornersMarkets = this.computeCornersMarkets(homeStats, awayStats);
    markets.push(...cornersMarkets);

    // Cards Markets
    const cardsMarkets = this.computeCardsMarkets(homeStats, awayStats);
    markets.push(...cardsMarkets);

    // BTTS (Both Teams to Score)
    const btts = this.computeBTTS(homeStats, awayStats);
    markets.push(...btts);

    // Apply injury adjustments
    const adjusted = markets.map((m) => {
      const injuryFactor = this.computeInjuryAdjustment(
        m.category,
        homeInjuries,
        awayInjuries,
        hasLineups,
      );
      return {
        ...m,
        probability: Math.max(0.01, Math.min(0.99, m.probability * injuryFactor)),
        confidence: hasLineups ? Math.min(m.confidence + 0.1, 1.0) : m.confidence,
      };
    });

    // Generate explanations
    const withExplanations = adjusted.map((m) => ({
      ...m,
      explanation: this.explanationService.generate(m, homeStats, awayStats, {
        homeInjuries,
        awayInjuries,
        homeTeamName: event.homeTeam.name,
        awayTeamName: event.awayTeam.name,
        hasLineups,
      }),
    }));

    // Save to database
    const saveOps = withExplanations.map((m) =>
      this.prisma.market.create({
        data: {
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
      }),
    );

    // Clear old markets first, then write new ones
    await this.prisma.market.deleteMany({ where: { eventId } });
    await this.prisma.$transaction(saveOps);

    // Update value bet flags
    await this.marketsService.updateValueBetFlags(eventId);

    // Generate Oracle Picks
    const picks = await this.picksService.generateForEvent(eventId);

    // Push update to connected WebSocket clients
    this.eventsGateway.broadcastPicksUpdate(eventId, picks);

    this.logger.log(
      `Computed ${withExplanations.length} markets, ${picks.length} picks for event ${eventId}`,
    );
  }

  // ─── Market Computation Methods ───

  private computeMatchResult(
    homeStats: TeamHistoryStats,
    awayStats: TeamHistoryStats,
    homeInjuries: InjuryInfo[],
    awayInjuries: InjuryInfo[],
  ) {
    const homeWinRate = homeStats.winRate;
    const awayWinRate = awayStats.winRate;
    const homeAdvantage = 0.08; // typical home advantage ~8%

    let homeProb = (homeWinRate + homeAdvantage) * 0.6 + 0.2;
    let awayProb = awayWinRate * 0.6 + 0.1;
    let drawProb = 1 - homeProb - awayProb;

    // Normalize
    const total = homeProb + awayProb + drawProb;
    homeProb /= total;
    awayProb /= total;
    drawProb /= total;

    const confidence = Math.min(homeStats.matchCount, awayStats.matchCount) >= 5 ? 0.7 : 0.4;

    return [
      {
        category: MarketCategory.MATCH_RESULT,
        name: 'Home Win',
        shortName: '1',
        probability: homeProb,
        confidence,
        explanation: '',
        explanationFactors: { homeWinRate, awayWinRate, homeAdvantage } as unknown as Prisma.JsonObject,
      },
      {
        category: MarketCategory.MATCH_RESULT,
        name: 'Draw',
        shortName: 'X',
        probability: drawProb,
        confidence,
        explanation: '',
        explanationFactors: { drawRate: drawProb } as unknown as Prisma.JsonObject,
      },
      {
        category: MarketCategory.MATCH_RESULT,
        name: 'Away Win',
        shortName: '2',
        probability: awayProb,
        confidence,
        explanation: '',
        explanationFactors: { homeWinRate, awayWinRate } as unknown as Prisma.JsonObject,
      },
    ];
  }

  private computeGoalsMarkets(homeStats: TeamHistoryStats, awayStats: TeamHistoryStats) {
    const avgGoals = homeStats.avgGoalsScored + awayStats.avgGoalsScored;
    const lines = [0.5, 1.5, 2.5, 3.5, 4.5];
    const markets: any[] = [];

    for (const line of lines) {
      // Poisson-approximated probability
      const overProb = this.poissonOverProb(avgGoals, line);
      const confidence = Math.min(homeStats.matchCount, awayStats.matchCount) >= 5 ? 0.65 : 0.35;

      markets.push({
        category: MarketCategory.GOALS,
        name: `Over ${line} Goals`,
        shortName: `O${line}`,
        line,
        probability: overProb,
        confidence,
        explanation: '',
        explanationFactors: {
          avgGoals: Math.round(avgGoals * 100) / 100,
          homeAvg: homeStats.avgGoalsScored,
          awayAvg: awayStats.avgGoalsScored,
        } as unknown as Prisma.JsonObject,
      });

      markets.push({
        category: MarketCategory.GOALS,
        name: `Under ${line} Goals`,
        shortName: `U${line}`,
        line,
        probability: 1 - overProb,
        confidence,
        explanation: '',
        explanationFactors: {
          avgGoals: Math.round(avgGoals * 100) / 100,
        } as unknown as Prisma.JsonObject,
      });
    }

    return markets;
  }

  private computeCornersMarkets(homeStats: TeamHistoryStats, awayStats: TeamHistoryStats) {
    const avgCorners = homeStats.avgCorners + awayStats.avgCorners;
    const lines = [7.5, 8.5, 9.5, 10.5, 11.5];
    const markets: any[] = [];

    for (const line of lines) {
      const overProb = this.poissonOverProb(avgCorners, line);
      const confidence = Math.min(homeStats.matchCount, awayStats.matchCount) >= 5 ? 0.6 : 0.3;

      markets.push({
        category: MarketCategory.CORNERS,
        name: `Over ${line} Corners`,
        shortName: `O${line}C`,
        line,
        probability: overProb,
        confidence,
        explanation: '',
        explanationFactors: {
          avgCorners: Math.round(avgCorners * 100) / 100,
          homeAvg: homeStats.avgCorners,
          awayAvg: awayStats.avgCorners,
        } as unknown as Prisma.JsonObject,
      });

      markets.push({
        category: MarketCategory.CORNERS,
        name: `Under ${line} Corners`,
        shortName: `U${line}C`,
        line,
        probability: 1 - overProb,
        confidence,
        explanation: '',
        explanationFactors: { avgCorners: Math.round(avgCorners * 100) / 100 } as unknown as Prisma.JsonObject,
      });
    }

    return markets;
  }

  private computeCardsMarkets(homeStats: TeamHistoryStats, awayStats: TeamHistoryStats) {
    const avgCards =
      homeStats.avgYellowCards +
      awayStats.avgYellowCards +
      (homeStats.avgRedCards + awayStats.avgRedCards) * 2;
    const lines = [2.5, 3.5, 4.5, 5.5];
    const markets: any[] = [];

    for (const line of lines) {
      const overProb = this.poissonOverProb(avgCards, line);
      const confidence = 0.5;

      markets.push({
        category: MarketCategory.CARDS,
        name: `Over ${line} Cards`,
        shortName: `O${line}K`,
        line,
        probability: overProb,
        confidence,
        explanation: '',
        explanationFactors: {
          avgCards: Math.round(avgCards * 100) / 100,
        } as unknown as Prisma.JsonObject,
      });

      markets.push({
        category: MarketCategory.CARDS,
        name: `Under ${line} Cards`,
        shortName: `U${line}K`,
        line,
        probability: 1 - overProb,
        confidence,
        explanation: '',
        explanationFactors: { avgCards: Math.round(avgCards * 100) / 100 } as unknown as Prisma.JsonObject,
      });
    }

    return markets;
  }

  private computeBTTS(homeStats: TeamHistoryStats, awayStats: TeamHistoryStats) {
    // BTTS probability: both teams score in the match
    const homeScoringRate = homeStats.matchCount > 0
      ? homeStats.matchesScored / homeStats.matchCount
      : 0.5;
    const awayScoringRate = awayStats.matchCount > 0
      ? awayStats.matchesScored / awayStats.matchCount
      : 0.5;

    const bttsProb = homeScoringRate * awayScoringRate;
    const confidence = Math.min(homeStats.matchCount, awayStats.matchCount) >= 5 ? 0.6 : 0.35;

    return [
      {
        category: MarketCategory.GOALS,
        name: 'Both Teams to Score — Yes',
        shortName: 'BTTS Y',
        probability: bttsProb,
        confidence,
        explanation: '',
        explanationFactors: {
          homeScoringRate: Math.round(homeScoringRate * 100) / 100,
          awayScoringRate: Math.round(awayScoringRate * 100) / 100,
        } as unknown as Prisma.JsonObject,
      },
      {
        category: MarketCategory.GOALS,
        name: 'Both Teams to Score — No',
        shortName: 'BTTS N',
        probability: 1 - bttsProb,
        confidence,
        explanation: '',
        explanationFactors: {} as unknown as Prisma.JsonObject,
      },
    ];
  }

  // ─── Supporting Calculations ───

  /**
   * Poisson CDF complement: P(X > line) ≈ 1 - P(X <= floor(line))
   */
  private poissonOverProb(lambda: number, line: number): number {
    const k = Math.floor(line);
    let cdf = 0;
    for (let i = 0; i <= k; i++) {
      cdf += (Math.pow(lambda, i) * Math.exp(-lambda)) / this.factorial(i);
    }
    return Math.max(0.01, Math.min(0.99, 1 - cdf));
  }

  private factorial(n: number): number {
    if (n <= 1) return 1;
    let result = 1;
    for (let i = 2; i <= n; i++) result *= i;
    return result;
  }

  /**
   * Compute injury-based probability adjustment factor.
   */
  private computeInjuryAdjustment(
    category: MarketCategory,
    homeInjuries: InjuryInfo[],
    awayInjuries: InjuryInfo[],
    hasLineups: boolean,
  ): number {
    const totalKeyInjuries = [...homeInjuries, ...awayInjuries].filter(
      (i) => i.status === 'Out',
    ).length;

    // Minimal adjustment — key players out slightly decrease predictability
    if (totalKeyInjuries === 0) return 1.0;
    if (totalKeyInjuries <= 2) return 0.97;
    if (totalKeyInjuries <= 4) return 0.94;
    return 0.90;
  }

  /**
   * Fetch aggregated historical stats for a team.
   */
  private async getTeamHistory(teamId: string): Promise<TeamHistoryStats> {
    const stats = await this.prisma.matchStats.findMany({
      where: { teamId },
      orderBy: { createdAt: 'desc' },
      take: this.MATCH_WINDOW,
    });

    if (stats.length === 0) {
      return this.defaultStats();
    }

    // Apply recency weighting
    const weighted = stats.map((s, idx) => {
      const weight =
        this.RECENCY_WEIGHT_MAX -
        (idx / Math.max(stats.length - 1, 1)) * (this.RECENCY_WEIGHT_MAX - 1);
      return { ...s, weight };
    });

    const totalWeight = weighted.reduce((sum, w) => sum + w.weight, 0);

    const avgGoalsScored =
      weighted.reduce((sum, w) => sum + w.goals * w.weight, 0) / totalWeight;
    const avgCorners =
      weighted.reduce((sum, w) => sum + w.corners * w.weight, 0) / totalWeight;
    const avgYellowCards =
      weighted.reduce((sum, w) => sum + w.yellowCards * w.weight, 0) / totalWeight;
    const avgRedCards =
      weighted.reduce((sum, w) => sum + w.redCards * w.weight, 0) / totalWeight;
    const avgPossession =
      weighted.reduce((sum, w) => sum + (w.possession || 50) * w.weight, 0) / totalWeight;
    const avgShotsOnTarget =
      weighted.reduce((sum, w) => sum + (w.shotsOnTarget || 0) * w.weight, 0) / totalWeight;

    const matchesScored = stats.filter((s) => s.goals > 0).length;
    const wins = stats.filter((s) => s.goals > 0).length; // simplified — needs opponent goals

    return {
      matchCount: stats.length,
      avgGoalsScored: Math.round(avgGoalsScored * 100) / 100,
      avgCorners: Math.round(avgCorners * 100) / 100,
      avgYellowCards: Math.round(avgYellowCards * 100) / 100,
      avgRedCards: Math.round(avgRedCards * 100) / 100,
      avgPossession: Math.round(avgPossession * 100) / 100,
      avgShotsOnTarget: Math.round(avgShotsOnTarget * 100) / 100,
      winRate: wins / stats.length,
      matchesScored,
    };
  }

  private async getTeamInjuries(teamId: string): Promise<InjuryInfo[]> {
    const injuries = await this.prisma.playerInjury.findMany({
      where: {
        player: { teamId },
        status: { in: ['Out', 'Doubtful'] },
      },
      include: {
        player: { select: { name: true, position: true } },
      },
    });

    return injuries.map((i) => ({
      playerName: i.player.name,
      position: i.player.position || 'Unknown',
      status: i.status,
      type: i.type,
    }));
  }

  private defaultStats(): TeamHistoryStats {
    return {
      matchCount: 0,
      avgGoalsScored: 1.3,
      avgCorners: 5.0,
      avgYellowCards: 1.8,
      avgRedCards: 0.1,
      avgPossession: 50,
      avgShotsOnTarget: 4.0,
      winRate: 0.33,
      matchesScored: 0,
    };
  }
}

// ─── Types ───

interface TeamHistoryStats {
  matchCount: number;
  avgGoalsScored: number;
  avgCorners: number;
  avgYellowCards: number;
  avgRedCards: number;
  avgPossession: number;
  avgShotsOnTarget: number;
  winRate: number;
  matchesScored: number;
}

interface InjuryInfo {
  playerName: string;
  position: string;
  status: string;
  type: string;
}
