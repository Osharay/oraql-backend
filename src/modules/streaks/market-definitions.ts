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
  /** Half-time score. Null when the provider did not record one. */
  htHomeGoals?: number | null;
  htAwayGoals?: number | null;
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
  requires: Array<'goals' | 'halftime' | 'corners' | 'cards'>;
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

/**
 * Half-time goals for one side, or null when no half-time score was recorded.
 * Every half-based market returns UNKNOWN in that case rather than guessing.
 */
const htTeam = (o: MatchOutcome, side: Selection): number | null => {
  const v = side === 'AWAY' ? o.htAwayGoals : o.htHomeGoals;
  return v == null ? null : v;
};
const htOpp = (o: MatchOutcome, side: Selection): number | null => {
  const v = side === 'AWAY' ? o.htHomeGoals : o.htAwayGoals;
  return v == null ? null : v;
};
const hasHalfTime = (o: MatchOutcome) => o.htHomeGoals != null && o.htAwayGoals != null;
/** Second-half goals: full time minus half time. */
const shTeam = (o: MatchOutcome, side: Selection) => teamGoals(o, side) - (htTeam(o, side) ?? 0);
const shOpp = (o: MatchOutcome, side: Selection) => oppGoals(o, side) - (htOpp(o, side) ?? 0);
const htTotal = (o: MatchOutcome) => (o.htHomeGoals ?? 0) + (o.htAwayGoals ?? 0);
const shTotal = (o: MatchOutcome) => totalGoals(o) - htTotal(o);

/** Wraps an evaluator that needs the half-time score. */
const needsHalfTime =
  (fn: (o: MatchOutcome, s: Selection) => Outcome) =>
  (o: MatchOutcome, s: Selection): Outcome =>
    hasHalfTime(o) ? fn(o, s) : 'UNKNOWN';

/** Asian handicap on a half line: no push is possible. */
const asianHalfLine = (o: MatchOutcome, side: Selection, handicap: number): Outcome =>
  yn(teamGoals(o, side) + handicap > oppGoals(o, side));

/**
 * Whether a market is about one club or about the match as a whole.
 *
 * A market whose selections are HOME/AWAY is resolved for one side: only one
 * team can be picked for Draw No Bet, and "Team Under 1.5 Goals" is that
 * team's goals, not the match total. A market whose only selection is MATCH
 * covers both teams combined. Nothing should have to infer this from a
 * candidate's `selection`, which is null for venue-agnostic slices.
 */
export type MarketScope = 'TEAM' | 'MATCH';

export function marketScope(marketId: string): MarketScope {
  const spec = MARKET_DEFINITIONS.find((m) => m.marketId === marketId);
  if (!spec) return 'MATCH';
  return spec.selections.includes('MATCH') ? 'MATCH' : 'TEAM';
}

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

  // ════════════════════════════════════════════════════════════════════
  // Extended vocabulary. From the client: "the more markets we have, the
  // more edge we have" — Win To Nil: No was a find precisely because nobody
  // looks at it. Everything below settles from the full-time and half-time
  // score alone, so it costs no provider requests beyond the fixture data
  // the backfill already downloads.
  // ════════════════════════════════════════════════════════════════════

  // ─── Full-time result, extended ───
  {
    marketId: 'DRAW',
    displayName: 'Draw',
    shortName: 'X',
    category: MarketCategory.MATCH_RESULT,
    selections: ['MATCH'],
    requires: ['goals'],
    evaluate: (o) => yn(o.homeGoals === o.awayGoals),
  },
  {
    marketId: 'TEAM_WIN_TO_NIL_YES',
    displayName: 'Team Win To Nil — Yes',
    shortName: 'WTN Yes',
    category: MarketCategory.MATCH_RESULT,
    selections: ['HOME', 'AWAY'],
    requires: ['goals'],
    evaluate: (o, s) => yn(teamGoals(o, s) > oppGoals(o, s) && oppGoals(o, s) === 0),
  },
  {
    marketId: 'TEAM_WIN_BY_EXACTLY_1',
    displayName: 'Team To Win By Exactly 1 Goal',
    shortName: 'Win by 1',
    category: MarketCategory.MATCH_RESULT,
    selections: ['HOME', 'AWAY'],
    requires: ['goals'],
    evaluate: (o, s) => yn(teamGoals(o, s) - oppGoals(o, s) === 1),
  },
  {
    marketId: 'TEAM_CLEAN_SHEET_YES',
    displayName: 'Team Clean Sheet — Yes',
    shortName: 'CS Yes',
    category: MarketCategory.GOALS,
    selections: ['HOME', 'AWAY'],
    requires: ['goals'],
    evaluate: (o, s) => yn(oppGoals(o, s) === 0),
  },
  {
    marketId: 'TEAM_CLEAN_SHEET_NO',
    displayName: 'Team Clean Sheet — No',
    shortName: 'CS No',
    category: MarketCategory.GOALS,
    selections: ['HOME', 'AWAY'],
    requires: ['goals'],
    evaluate: (o, s) => yn(oppGoals(o, s) > 0),
  },
  {
    marketId: 'TEAM_UNDER_2_5',
    displayName: 'Team Under 2.5 Goals',
    shortName: 'Team U2.5',
    category: MarketCategory.GOALS,
    line: 2.5,
    selections: ['HOME', 'AWAY'],
    requires: ['goals'],
    evaluate: (o, s) => yn(teamGoals(o, s) <= 2),
  },

  // ─── Result combinations ───
  {
    marketId: 'TEAM_WIN_AND_OVER_1_5',
    displayName: 'Team To Win & Over 1.5 Goals',
    shortName: 'Win & O1.5',
    category: MarketCategory.SPECIAL,
    line: 1.5,
    selections: ['HOME', 'AWAY'],
    requires: ['goals'],
    evaluate: (o, s) => yn(teamGoals(o, s) > oppGoals(o, s) && totalGoals(o) >= 2),
  },
  {
    marketId: 'TEAM_WIN_AND_BTTS',
    displayName: 'Team To Win & Both Teams To Score',
    shortName: 'Win & BTTS',
    category: MarketCategory.SPECIAL,
    selections: ['HOME', 'AWAY'],
    requires: ['goals'],
    evaluate: (o, s) =>
      yn(teamGoals(o, s) > oppGoals(o, s) && o.homeGoals > 0 && o.awayGoals > 0),
  },
  {
    marketId: 'BTTS_AND_OVER_2_5',
    displayName: 'Both Teams To Score & Over 2.5',
    shortName: 'BTTS & O2.5',
    category: MarketCategory.SPECIAL,
    line: 2.5,
    selections: ['MATCH'],
    requires: ['goals'],
    evaluate: (o) => yn(o.homeGoals > 0 && o.awayGoals > 0 && totalGoals(o) >= 3),
  },

  // ─── Match goals, extended ───
  {
    marketId: 'MATCH_UNDER_1_5',
    displayName: 'Under 1.5 Goals',
    shortName: 'U1.5',
    category: MarketCategory.GOALS,
    line: 1.5,
    selections: ['MATCH'],
    requires: ['goals'],
    evaluate: (o) => yn(totalGoals(o) <= 1),
  },
  {
    marketId: 'MATCH_OVER_4_5',
    displayName: 'Over 4.5 Goals',
    shortName: 'O4.5',
    category: MarketCategory.GOALS,
    line: 4.5,
    selections: ['MATCH'],
    requires: ['goals'],
    evaluate: (o) => yn(totalGoals(o) >= 5),
  },
  {
    marketId: 'MATCH_UNDER_4_5',
    displayName: 'Under 4.5 Goals',
    shortName: 'U4.5',
    category: MarketCategory.GOALS,
    line: 4.5,
    selections: ['MATCH'],
    requires: ['goals'],
    evaluate: (o) => yn(totalGoals(o) <= 4),
  },
  {
    marketId: 'TOTAL_GOALS_2_OR_3',
    displayName: 'Total Goals 2 or 3',
    shortName: 'Goals 2-3',
    category: MarketCategory.GOALS,
    selections: ['MATCH'],
    requires: ['goals'],
    evaluate: (o) => yn(totalGoals(o) === 2 || totalGoals(o) === 3),
  },
  {
    marketId: 'TOTAL_GOALS_ODD',
    displayName: 'Total Goals — Odd',
    shortName: 'Odd',
    category: MarketCategory.GOALS,
    selections: ['MATCH'],
    requires: ['goals'],
    evaluate: (o) => yn(totalGoals(o) % 2 === 1),
  },
  {
    marketId: 'TOTAL_GOALS_EVEN',
    displayName: 'Total Goals — Even',
    shortName: 'Even',
    category: MarketCategory.GOALS,
    selections: ['MATCH'],
    requires: ['goals'],
    evaluate: (o) => yn(totalGoals(o) % 2 === 0),
    notes: '0-0 counts as even, as bookmakers settle it.',
  },

  // ─── First half ───
  {
    marketId: 'HT_TEAM_WIN',
    displayName: 'Team To Win First Half',
    shortName: 'HT Win',
    category: MarketCategory.HALFTIME,
    selections: ['HOME', 'AWAY'],
    requires: ['goals', 'halftime'],
    evaluate: needsHalfTime((o, s) => yn(htTeam(o, s)! > htOpp(o, s)!)),
  },
  {
    marketId: 'HT_DRAW',
    displayName: 'First Half Draw',
    shortName: 'HT X',
    category: MarketCategory.HALFTIME,
    selections: ['MATCH'],
    requires: ['goals', 'halftime'],
    evaluate: needsHalfTime((o) => yn(o.htHomeGoals === o.htAwayGoals)),
  },
  {
    marketId: 'HT_DOUBLE_CHANCE_TEAM_OR_DRAW',
    displayName: 'First Half Double Chance — Team or Draw',
    shortName: 'HT DC',
    category: MarketCategory.HALFTIME,
    selections: ['HOME', 'AWAY'],
    requires: ['goals', 'halftime'],
    evaluate: needsHalfTime((o, s) => yn(htTeam(o, s)! >= htOpp(o, s)!)),
  },
  {
    marketId: 'HT_OVER_0_5',
    displayName: 'First Half Over 0.5 Goals',
    shortName: 'HT O0.5',
    category: MarketCategory.HALFTIME,
    line: 0.5,
    selections: ['MATCH'],
    requires: ['goals', 'halftime'],
    evaluate: needsHalfTime((o) => yn(htTotal(o) >= 1)),
  },
  {
    marketId: 'HT_OVER_1_5',
    displayName: 'First Half Over 1.5 Goals',
    shortName: 'HT O1.5',
    category: MarketCategory.HALFTIME,
    line: 1.5,
    selections: ['MATCH'],
    requires: ['goals', 'halftime'],
    evaluate: needsHalfTime((o) => yn(htTotal(o) >= 2)),
  },
  {
    marketId: 'HT_UNDER_0_5',
    displayName: 'First Half Under 0.5 Goals',
    shortName: 'HT U0.5',
    category: MarketCategory.HALFTIME,
    line: 0.5,
    selections: ['MATCH'],
    requires: ['goals', 'halftime'],
    evaluate: needsHalfTime((o) => yn(htTotal(o) === 0)),
  },
  {
    marketId: 'HT_UNDER_1_5',
    displayName: 'First Half Under 1.5 Goals',
    shortName: 'HT U1.5',
    category: MarketCategory.HALFTIME,
    line: 1.5,
    selections: ['MATCH'],
    requires: ['goals', 'halftime'],
    evaluate: needsHalfTime((o) => yn(htTotal(o) <= 1)),
  },
  {
    marketId: 'HT_BTTS_YES',
    displayName: 'Both Teams To Score In First Half',
    shortName: 'HT BTTS',
    category: MarketCategory.HALFTIME,
    selections: ['MATCH'],
    requires: ['goals', 'halftime'],
    evaluate: needsHalfTime((o) => yn(o.htHomeGoals! > 0 && o.htAwayGoals! > 0)),
  },
  {
    marketId: 'HT_BTTS_NO',
    displayName: 'Both Teams To Score In First Half — No',
    shortName: 'HT BTTS No',
    category: MarketCategory.HALFTIME,
    selections: ['MATCH'],
    requires: ['goals', 'halftime'],
    evaluate: needsHalfTime((o) => yn(!(o.htHomeGoals! > 0 && o.htAwayGoals! > 0))),
  },
  {
    marketId: 'HT_TEAM_OVER_0_5',
    displayName: 'Team To Score In First Half',
    shortName: 'HT Team O0.5',
    category: MarketCategory.HALFTIME,
    line: 0.5,
    selections: ['HOME', 'AWAY'],
    requires: ['goals', 'halftime'],
    evaluate: needsHalfTime((o, s) => yn(htTeam(o, s)! >= 1)),
  },
  {
    marketId: 'HT_TEAM_UNDER_0_5',
    displayName: 'Team Not To Score In First Half',
    shortName: 'HT Team U0.5',
    category: MarketCategory.HALFTIME,
    line: 0.5,
    selections: ['HOME', 'AWAY'],
    requires: ['goals', 'halftime'],
    evaluate: needsHalfTime((o, s) => yn(htTeam(o, s)! === 0)),
  },

  // ─── Second half ───
  {
    marketId: 'SH_TEAM_WIN',
    displayName: 'Team To Win Second Half',
    shortName: '2H Win',
    category: MarketCategory.HALFTIME,
    selections: ['HOME', 'AWAY'],
    requires: ['goals', 'halftime'],
    evaluate: needsHalfTime((o, s) => yn(shTeam(o, s) > shOpp(o, s))),
  },
  {
    marketId: 'SH_DRAW',
    displayName: 'Second Half Draw',
    shortName: '2H X',
    category: MarketCategory.HALFTIME,
    selections: ['MATCH'],
    requires: ['goals', 'halftime'],
    evaluate: needsHalfTime((o) => yn(shTeam(o, 'HOME') === shTeam(o, 'AWAY'))),
  },
  {
    marketId: 'SH_OVER_0_5',
    displayName: 'Second Half Over 0.5 Goals',
    shortName: '2H O0.5',
    category: MarketCategory.HALFTIME,
    line: 0.5,
    selections: ['MATCH'],
    requires: ['goals', 'halftime'],
    evaluate: needsHalfTime((o) => yn(shTotal(o) >= 1)),
  },
  {
    marketId: 'SH_OVER_1_5',
    displayName: 'Second Half Over 1.5 Goals',
    shortName: '2H O1.5',
    category: MarketCategory.HALFTIME,
    line: 1.5,
    selections: ['MATCH'],
    requires: ['goals', 'halftime'],
    evaluate: needsHalfTime((o) => yn(shTotal(o) >= 2)),
  },
  {
    marketId: 'SH_UNDER_1_5',
    displayName: 'Second Half Under 1.5 Goals',
    shortName: '2H U1.5',
    category: MarketCategory.HALFTIME,
    line: 1.5,
    selections: ['MATCH'],
    requires: ['goals', 'halftime'],
    evaluate: needsHalfTime((o) => yn(shTotal(o) <= 1)),
  },
  {
    marketId: 'SH_BTTS_YES',
    displayName: 'Both Teams To Score In Second Half',
    shortName: '2H BTTS',
    category: MarketCategory.HALFTIME,
    selections: ['MATCH'],
    requires: ['goals', 'halftime'],
    evaluate: needsHalfTime((o) => yn(shTeam(o, 'HOME') > 0 && shTeam(o, 'AWAY') > 0)),
  },
  {
    marketId: 'SH_TEAM_OVER_0_5',
    displayName: 'Team To Score In Second Half',
    shortName: '2H Team O0.5',
    category: MarketCategory.HALFTIME,
    line: 0.5,
    selections: ['HOME', 'AWAY'],
    requires: ['goals', 'halftime'],
    evaluate: needsHalfTime((o, s) => yn(shTeam(o, s) >= 1)),
  },

  // ─── Across both halves ───
  {
    marketId: 'TEAM_SCORE_BOTH_HALVES',
    displayName: 'Team To Score In Both Halves',
    shortName: 'Score both halves',
    category: MarketCategory.HALFTIME,
    selections: ['HOME', 'AWAY'],
    requires: ['goals', 'halftime'],
    evaluate: needsHalfTime((o, s) => yn(htTeam(o, s)! >= 1 && shTeam(o, s) >= 1)),
  },
  {
    marketId: 'TEAM_WIN_EITHER_HALF',
    displayName: 'Team To Win Either Half',
    shortName: 'Win either half',
    category: MarketCategory.HALFTIME,
    selections: ['HOME', 'AWAY'],
    requires: ['goals', 'halftime'],
    evaluate: needsHalfTime((o, s) =>
      yn(htTeam(o, s)! > htOpp(o, s)! || shTeam(o, s) > shOpp(o, s)),
    ),
  },
  {
    marketId: 'TEAM_WIN_BOTH_HALVES',
    displayName: 'Team To Win Both Halves',
    shortName: 'Win both halves',
    category: MarketCategory.HALFTIME,
    selections: ['HOME', 'AWAY'],
    requires: ['goals', 'halftime'],
    evaluate: needsHalfTime((o, s) =>
      yn(htTeam(o, s)! > htOpp(o, s)! && shTeam(o, s) > shOpp(o, s)),
    ),
  },
  {
    marketId: 'GOAL_IN_BOTH_HALVES',
    displayName: 'Goal In Both Halves',
    shortName: 'Goal both halves',
    category: MarketCategory.HALFTIME,
    selections: ['MATCH'],
    requires: ['goals', 'halftime'],
    evaluate: needsHalfTime((o) => yn(htTotal(o) >= 1 && shTotal(o) >= 1)),
  },
  {
    marketId: 'BTTS_BOTH_HALVES',
    displayName: 'Both Teams To Score In Both Halves',
    shortName: 'BTTS both halves',
    category: MarketCategory.HALFTIME,
    selections: ['MATCH'],
    requires: ['goals', 'halftime'],
    evaluate: needsHalfTime((o) =>
      yn(
        o.htHomeGoals! > 0 &&
          o.htAwayGoals! > 0 &&
          shTeam(o, 'HOME') > 0 &&
          shTeam(o, 'AWAY') > 0,
      ),
    ),
  },
  {
    marketId: 'HIGHEST_SCORING_HALF_FIRST',
    displayName: 'Highest Scoring Half — First',
    shortName: 'HSH 1st',
    category: MarketCategory.HALFTIME,
    selections: ['MATCH'],
    requires: ['goals', 'halftime'],
    evaluate: needsHalfTime((o) => yn(htTotal(o) > shTotal(o))),
    notes: 'Equal halves lose — bookmakers price the tie as its own selection.',
  },
  {
    marketId: 'HIGHEST_SCORING_HALF_SECOND',
    displayName: 'Highest Scoring Half — Second',
    shortName: 'HSH 2nd',
    category: MarketCategory.HALFTIME,
    selections: ['MATCH'],
    requires: ['goals', 'halftime'],
    evaluate: needsHalfTime((o) => yn(shTotal(o) > htTotal(o))),
    notes: 'Equal halves lose — bookmakers price the tie as its own selection.',
  },

  // ─── Half-time / full-time ───
  {
    marketId: 'HTFT_TEAM_TEAM',
    displayName: 'Team Leads At Half-time And Wins',
    shortName: 'HT/FT 1/1',
    category: MarketCategory.HALFTIME,
    selections: ['HOME', 'AWAY'],
    requires: ['goals', 'halftime'],
    evaluate: needsHalfTime((o, s) =>
      yn(htTeam(o, s)! > htOpp(o, s)! && teamGoals(o, s) > oppGoals(o, s)),
    ),
  },
  {
    marketId: 'HTFT_DRAW_TEAM',
    displayName: 'Team Level At Half-time, Then Wins',
    shortName: 'HT/FT X/1',
    category: MarketCategory.HALFTIME,
    selections: ['HOME', 'AWAY'],
    requires: ['goals', 'halftime'],
    evaluate: needsHalfTime((o, s) =>
      yn(htTeam(o, s) === htOpp(o, s) && teamGoals(o, s) > oppGoals(o, s)),
    ),
  },
  {
    marketId: 'HTFT_DRAW_DRAW',
    displayName: 'Half-time/Full-time — Draw/Draw',
    shortName: 'HT/FT X/X',
    category: MarketCategory.HALFTIME,
    selections: ['MATCH'],
    requires: ['goals', 'halftime'],
    evaluate: needsHalfTime((o) =>
      yn(o.htHomeGoals === o.htAwayGoals && o.homeGoals === o.awayGoals),
    ),
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
