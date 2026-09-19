import { Injectable } from '@nestjs/common';
import { MarketCategory, Prisma } from '@prisma/client';

interface MarketInput {
  category: MarketCategory;
  name: string;
  probability: number;
  confidence: number;
  explanationFactors: Prisma.JsonObject;
}

interface ExplanationContext {
  homeInjuries: Array<{ playerName: string; position: string; status: string }>;
  awayInjuries: Array<{ playerName: string; position: string; status: string }>;
  homeTeamName: string;
  awayTeamName: string;
  hasLineups: boolean;
}

interface TeamStats {
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

/**
 * Generates human-readable explanations for Oracle's probability calculations.
 * Every Oracle Pick includes a plain-language explanation — no jargon, no black box.
 */
@Injectable()
export class ExplanationService {
  generate(
    market: MarketInput,
    homeStats: TeamStats,
    awayStats: TeamStats,
    ctx: ExplanationContext,
  ): string {
    const parts: string[] = [];

    switch (market.category) {
      case MarketCategory.MATCH_RESULT:
        parts.push(this.explainMatchResult(market, homeStats, awayStats, ctx));
        break;
      case MarketCategory.GOALS:
        parts.push(this.explainGoals(market, homeStats, awayStats, ctx));
        break;
      case MarketCategory.CORNERS:
        parts.push(this.explainCorners(market, homeStats, awayStats, ctx));
        break;
      case MarketCategory.CARDS:
        parts.push(this.explainCards(market, homeStats, awayStats, ctx));
        break;
      default:
        parts.push(this.explainGeneric(market, homeStats, awayStats, ctx));
    }

    // Injury caveats
    const keyInjuries = [...ctx.homeInjuries, ...ctx.awayInjuries].filter(
      (i) => i.status === 'Out',
    );
    if (keyInjuries.length > 0) {
      const injuryList = keyInjuries
        .slice(0, 3)
        .map((i) => `${i.playerName} (${i.position})`)
        .join(', ');
      parts.push(`Note: ${injuryList} ${keyInjuries.length === 1 ? 'is' : 'are'} confirmed out.`);
    }

    // Lineup status
    if (ctx.hasLineups) {
      parts.push('Lineups confirmed — probability reflects actual starting XIs.');
    }

    // Confidence caveat
    if (market.confidence < 0.5) {
      parts.push('Limited historical data available — treat this prediction with extra caution.');
    }

    return parts.join(' ');
  }

  private explainMatchResult(
    market: MarketInput,
    homeStats: TeamStats,
    awayStats: TeamStats,
    ctx: ExplanationContext,
  ): string {
    const prob = (market.probability * 100).toFixed(0);

    if (market.name === 'Home Win') {
      return `${ctx.homeTeamName} has a ${prob}% chance of winning at home. They've won ${(homeStats.winRate * 100).toFixed(0)}% of their last ${homeStats.matchCount} matches, averaging ${homeStats.avgGoalsScored} goals per game. Home advantage provides an additional edge.`;
    }
    if (market.name === 'Away Win') {
      return `${ctx.awayTeamName} has a ${prob}% chance of winning away. Their recent form shows a ${(awayStats.winRate * 100).toFixed(0)}% win rate across ${awayStats.matchCount} matches with ${awayStats.avgGoalsScored} goals per game on average.`;
    }
    return `A draw is estimated at ${prob}%, reflecting the relative balance between the two sides based on recent form.`;
  }

  private explainGoals(
    market: MarketInput,
    homeStats: TeamStats,
    awayStats: TeamStats,
    ctx: ExplanationContext,
  ): string {
    const prob = (market.probability * 100).toFixed(0);
    const factors = market.explanationFactors as any;

    if (market.name.includes('BTTS')) {
      const homeRate = factors.homeScoringRate
        ? (factors.homeScoringRate * 100).toFixed(0)
        : '—';
      const awayRate = factors.awayScoringRate
        ? (factors.awayScoringRate * 100).toFixed(0)
        : '—';
      return `Both teams scoring has a ${prob}% probability. ${ctx.homeTeamName} scores in ${homeRate}% of recent matches, while ${ctx.awayTeamName} scores in ${awayRate}%.`;
    }

    const avgGoals = factors.avgGoals || (homeStats.avgGoalsScored + awayStats.avgGoalsScored);
    const games = Math.min(homeStats.matchCount, awayStats.matchCount);

    // Saying "from their last 0 games" while showing a confident percentage is
    // how a default constant gets mistaken for analysis.
    if (games === 0) {
      return `${market.name} is estimated at ${prob}%, but no completed matches have been recorded for these teams yet. This figure comes from league-average assumptions, not from either side's form.`;
    }

    return `${market.name} covers the combined score of the whole match, not either team on its own. Estimated at ${prob}%: together the two sides average ${avgGoals.toFixed(1)} goals per match — ${ctx.homeTeamName} ${homeStats.avgGoalsScored} and ${ctx.awayTeamName} ${awayStats.avgGoalsScored} across their last ${games} ${games === 1 ? 'game' : 'games'}.`;
  }

  private explainCorners(
    market: MarketInput,
    homeStats: TeamStats,
    awayStats: TeamStats,
    ctx: ExplanationContext,
  ): string {
    const prob = (market.probability * 100).toFixed(0);
    const avgCorners = homeStats.avgCorners + awayStats.avgCorners;
    return `${market.name} has a ${prob}% probability. ${ctx.homeTeamName} averages ${homeStats.avgCorners} corners and ${ctx.awayTeamName} averages ${awayStats.avgCorners} per match, totaling approximately ${avgCorners.toFixed(1)} corners combined.`;
  }

  private explainCards(
    market: MarketInput,
    homeStats: TeamStats,
    awayStats: TeamStats,
    ctx: ExplanationContext,
  ): string {
    const prob = (market.probability * 100).toFixed(0);
    const avgCards =
      homeStats.avgYellowCards + awayStats.avgYellowCards;
    return `${market.name} is at ${prob}%. ${ctx.homeTeamName} averages ${homeStats.avgYellowCards} yellow cards and ${ctx.awayTeamName} averages ${awayStats.avgYellowCards} per match (${avgCards.toFixed(1)} combined).`;
  }

  private explainGeneric(
    market: MarketInput,
    homeStats: TeamStats,
    awayStats: TeamStats,
    ctx: ExplanationContext,
  ): string {
    const games = Math.min(homeStats.matchCount, awayStats.matchCount);

    if (games === 0) {
      return `${market.name} is estimated at ${(market.probability * 100).toFixed(0)}%, based on league-average assumptions — no completed matches have been recorded for these teams yet.`;
    }

    return `${market.name} has a ${(market.probability * 100).toFixed(0)}% estimated probability, based on the last ${games} ${games === 1 ? 'match' : 'matches'} for both teams.`;
  }
}
