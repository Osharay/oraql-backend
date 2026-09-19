import { MarketCategory } from '@prisma/client';

/**
 * The market definition registry.
 *
 * Adding a market means adding one entry here — the streak engine reads this
 * list and never hard-codes a market anywhere else. Win conditions are plain
 * functions rather than an interpreted JSON DSL: they typecheck, they are
 * testable, and they stay readable.
 */

export type Selection = 'HOME' | 'AWAY' | 'MATCH';
export type Outcome = 'WIN' | 'LOSS' | 'VOID' | 'UNKNOWN';

/** Everything an evaluator may look at, as recorded for a finished match. */
export interface MatchOutcome {
  homeGoals: number;
  awayGoals: number;
  homeCorners?: number | null;
  awayCorners?: number | null;
  homeYellowCards?: number | null;
  awayYellowCards?: number | null;
}

export interface MarketDefinitionSpec {
  marketId: string;
  displayName: string;
  shortName?: string;
  category: MarketCategory;
  line?: number;
  selections: Selection[];
  /** Stat fields the evaluator needs. Missing ones yield UNKNOWN, never a guess. */
  requires: Array<'goals' | 'corners' | 'cards'>;
  evaluate: (o: MatchOutcome, side: Selection) => Outcome;
  notes?: string;
}

// ─── helpers ───
const teamGoals = (o: MatchOutcome, side: Selection) =>
  side === 'AWAY' ? o.awayGoals : o.homeGoals;
const oppGoals = (o: MatchOutcome, side: Selection) =>
  side === 'AWAY' ? o.homeGoals : o.awayGoals;
const totalGoals = (o: MatchOutcome) => o.homeGoals + o.awayGoals;
const yn = (b: boolean): Outcome => (b ? 'WIN' : 'LOSS');

/** Asian handicap on a half line: no push is possible. */
const asianHalfLine = (o: MatchOutcome, side: Selection, handicap: number): Outcome =>
  yn(teamGoals(o, side) + handicap > oppGoals(o, side));

export const MARKET_DEFINITIONS: MarketDefinitionSpec[] = [
  // ─── Team goals ───
  {
    marketId: 'TEAM_OVER_0_5',
    displayName: 'Team Over 0.5 Goals',
    shortName: 'Team O0.5',
    category: MarketCategory.GOALS,
    line: 0.5,
    selections: ['HOME', 'AWAY'],
    requires: ['goals'],
    evaluate: (o, s) => yn(teamGoals(o, s) >= 1),
    notes: 'High base rate (~80%). Only interesting as lift, never as raw hit rate.',
  },
  {
    marketId: 'TEAM_OVER_1_5',
    displayName: 'Team Over 1.5 Goals',
    shortName: 'Team O1.5',
    category: MarketCategory.GOALS,
    line: 1.5,
    selections: ['HOME', 'AWAY'],
    requires: ['goals'],
    evaluate: (o, s) => yn(teamGoals(o, s) >= 2),
  },
  {
    marketId: 'TEAM_OVER_2_5',
    displayName: 'Team Over 2.5 Goals',
    shortName: 'Team O2.5',
    category: MarketCategory.GOALS,
    line: 2.5,
    selections: ['HOME', 'AWAY'],
    requires: ['goals'],
    evaluate: (o, s) => yn(teamGoals(o, s) >= 3),
  },
  {
    marketId: 'TEAM_UNDER_0_5',
    displayName: 'Team Under 0.5 Goals',
    shortName: 'Team U0.5',
    category: MarketCategory.GOALS,
    line: 0.5,
    selections: ['HOME', 'AWAY'],
    requires: ['goals'],
    evaluate: (o, s) => yn(teamGoals(o, s) === 0),
  },
  {
    marketId: 'TEAM_UNDER_1_5',
    displayName: 'Team Under 1.5 Goals',
    shortName: 'Team U1.5',
    category: MarketCategory.GOALS,
    line: 1.5,
    selections: ['HOME', 'AWAY'],
    requires: ['goals'],
    evaluate: (o, s) => yn(teamGoals(o, s) <= 1),
  },
  {
    marketId: 'OPPONENT_UNDER_1_5',
    displayName: 'Opponent Under 1.5 Goals',
    shortName: 'Opp U1.5',
    category: MarketCategory.GOALS,
    line: 1.5,
    selections: ['HOME', 'AWAY'],
    requires: ['goals'],
    evaluate: (o, s) => yn(oppGoals(o, s) <= 1),
    notes: 'The defensive mirror — selection names the team whose opponent is limited.',
  },

  // ─── Match goals ───
  {
    marketId: 'MATCH_OVER_1_5',
    displayName: 'Over 1.5 Goals',
    shortName: 'O1.5',
    category: MarketCategory.GOALS,
    line: 1.5,
    selections: ['MATCH'],
    requires: ['goals'],
    evaluate: (o) => yn(totalGoals(o) >= 2),
  },
  {
    marketId: 'MATCH_OVER_2_5',
    displayName: 'Over 2.5 Goals',
    shortName: 'O2.5',
    category: MarketCategory.GOALS,
    line: 2.5,
    selections: ['MATCH'],
    requires: ['goals'],
    evaluate: (o) => yn(totalGoals(o) >= 3),
  },
  {
    marketId: 'MATCH_OVER_3_5',
    displayName: 'Over 3.5 Goals',
    shortName: 'O3.5',
    category: MarketCategory.GOALS,
    line: 3.5,
    selections: ['MATCH'],
    requires: ['goals'],
    evaluate: (o) => yn(totalGoals(o) >= 4),
  },
  {
    marketId: 'MATCH_UNDER_2_5',
    displayName: 'Under 2.5 Goals',
    shortName: 'U2.5',
    category: MarketCategory.GOALS,
    line: 2.5,
    selections: ['MATCH'],
    requires: ['goals'],
    evaluate: (o) => yn(totalGoals(o) <= 2),
  },
  {
    marketId: 'MATCH_UNDER_3_5',
    displayName: 'Under 3.5 Goals',
    shortName: 'U3.5',
    category: MarketCategory.GOALS,
    line: 3.5,
    selections: ['MATCH'],
    requires: ['goals'],
    evaluate: (o) => yn(totalGoals(o) <= 3),
  },

  // ─── Both teams to score ───
  {
    marketId: 'BTTS_YES',
    displayName: 'Both Teams To Score — Yes',
    shortName: 'BTTS',
    category: MarketCategory.GOALS,
    selections: ['MATCH'],
    requires: ['goals'],
    evaluate: (o) => yn(o.homeGoals >= 1 && o.awayGoals >= 1),
  },
  {
    marketId: 'BTTS_NO',
    displayName: 'Both Teams To Score — No',
    shortName: 'BTTS No',
    category: MarketCategory.GOALS,
    selections: ['MATCH'],
    requires: ['goals'],
    evaluate: (o) => yn(o.homeGoals === 0 || o.awayGoals === 0),
  },

  // ─── Result markets ───
  {
    marketId: 'TEAM_WIN',
    displayName: 'Team To Win',
    shortName: 'Win',
    category: MarketCategory.MATCH_RESULT,
    selections: ['HOME', 'AWAY'],
    requires: ['goals'],
    evaluate: (o, s) => yn(teamGoals(o, s) > oppGoals(o, s)),
  },
  {
    marketId: 'TEAM_WIN_TO_NIL_NO',
    displayName: 'Team Win To Nil — No',
    shortName: 'WTN No',
    category: MarketCategory.MATCH_RESULT,
    selections: ['HOME', 'AWAY'],
    requires: ['goals'],
    evaluate: (o, s) =>
      yn(!(teamGoals(o, s) > oppGoals(o, s) && oppGoals(o, s) === 0)),
    notes: 'NOT(win AND clean sheet) — covers three outcome classes in one selection.',
  },
  {
    marketId: 'DRAW_NO_BET',
    displayName: 'Draw No Bet',
    shortName: 'DNB',
    category: MarketCategory.MATCH_RESULT,
    selections: ['HOME', 'AWAY'],
    requires: ['goals'],
    evaluate: (o, s) => {
      if (teamGoals(o, s) === oppGoals(o, s)) return 'VOID';
      return yn(teamGoals(o, s) > oppGoals(o, s));
    },
    notes: 'A draw voids. VOID rows are excluded from hit-rate denominators.',
  },
  {
    marketId: 'DOUBLE_CHANCE_TEAM_OR_DRAW',
    displayName: 'Double Chance — Team or Draw',
    shortName: 'DC',
    category: MarketCategory.MATCH_RESULT,
    selections: ['HOME', 'AWAY'],
    requires: ['goals'],
    evaluate: (o, s) => yn(teamGoals(o, s) >= oppGoals(o, s)),
  },
  {
    marketId: 'DOUBLE_CHANCE_HOME_OR_AWAY',
    displayName: 'Double Chance — Home or Away',
    shortName: 'DC 12',
    category: MarketCategory.MATCH_RESULT,
    selections: ['MATCH'],
    requires: ['goals'],
    evaluate: (o) => yn(o.homeGoals !== o.awayGoals),
  },
  {
    marketId: 'HOME_OR_AWAY_AND_OVER_2_5',
    displayName: 'Home or Away & Over 2.5',
    shortName: '12 & O2.5',
    category: MarketCategory.SPECIAL,
    line: 2.5,
    selections: ['MATCH'],
    requires: ['goals'],
    evaluate: (o) => yn(o.homeGoals !== o.awayGoals && totalGoals(o) >= 3),
  },

  // ─── Asian handicaps (half lines — no push) ───
  {
    marketId: 'AH_MINUS_1_5',
    displayName: 'Asian Handicap -1.5',
    shortName: 'AH -1.5',
    category: MarketCategory.HANDICAP,
    line: -1.5,
    selections: ['HOME', 'AWAY'],
    requires: ['goals'],
    evaluate: (o, s) => asianHalfLine(o, s, -1.5),
  },
  {
    marketId: 'AH_PLUS_1_5',
    displayName: 'Asian Handicap +1.5',
    shortName: 'AH +1.5',
    category: MarketCategory.HANDICAP,
    line: 1.5,
    selections: ['HOME', 'AWAY'],
    requires: ['goals'],
    evaluate: (o, s) => asianHalfLine(o, s, 1.5),
  },
  {
    marketId: 'AH_MINUS_2_5',
    displayName: 'Asian Handicap -2.5',
    shortName: 'AH -2.5',
    category: MarketCategory.HANDICAP,
    line: -2.5,
    selections: ['HOME', 'AWAY'],
    requires: ['goals'],
    evaluate: (o, s) => asianHalfLine(o, s, -2.5),
  },
  {
    marketId: 'AH_PLUS_2_5',
    displayName: 'Asian Handicap +2.5',
    shortName: 'AH +2.5',
    category: MarketCategory.HANDICAP,
    line: 2.5,
    selections: ['HOME', 'AWAY'],
    requires: ['goals'],
    evaluate: (o, s) => asianHalfLine(o, s, 2.5),
  },

  // ─── Corners ───
  {
    marketId: 'MATCH_CORNERS_OVER_8_5',
    displayName: 'Over 8.5 Corners',
    shortName: 'Crn O8.5',
    category: MarketCategory.CORNERS,
    line: 8.5,
    selections: ['MATCH'],
    requires: ['corners'],
    evaluate: (o) => {
      if (o.homeCorners == null || o.awayCorners == null) return 'UNKNOWN';
      return yn(o.homeCorners + o.awayCorners >= 9);
    },
  },
  {
    marketId: 'MATCH_CORNERS_OVER_10_5',
    displayName: 'Over 10.5 Corners',
    shortName: 'Crn O10.5',
    category: MarketCategory.CORNERS,
    line: 10.5,
    selections: ['MATCH'],
    requires: ['corners'],
    evaluate: (o) => {
      if (o.homeCorners == null || o.awayCorners == null) return 'UNKNOWN';
      return yn(o.homeCorners + o.awayCorners >= 11);
    },
  },
  {
    marketId: 'TEAM_CORNERS_OVER_4_5',
    displayName: 'Team Over 4.5 Corners',
    shortName: 'Team Crn O4.5',
    category: MarketCategory.CORNERS,
    line: 4.5,
    selections: ['HOME', 'AWAY'],
    requires: ['corners'],
    evaluate: (o, s) => {
      const c = s === 'AWAY' ? o.awayCorners : o.homeCorners;
      if (c == null) return 'UNKNOWN';
      return yn(c >= 5);
    },
  },

  // ─── Cards ───
  {
    marketId: 'MATCH_CARDS_OVER_3_5',
    displayName: 'Over 3.5 Cards',
    shortName: 'Cards O3.5',
    category: MarketCategory.CARDS,
    line: 3.5,
    selections: ['MATCH'],
    requires: ['cards'],
    evaluate: (o) => {
      if (o.homeYellowCards == null || o.awayYellowCards == null) return 'UNKNOWN';
      return yn(o.homeYellowCards + o.awayYellowCards >= 4);
    },
  },
];

export const MARKET_BY_ID = new Map(MARKET_DEFINITIONS.map((m) => [m.marketId, m]));
