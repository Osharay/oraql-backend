import {
  MARKET_DEFINITIONS,
  MARKET_BY_ID,
  MatchOutcome,
  Outcome,
  Selection,
} from './market-definitions';

/**
 * Evaluator correctness.
 *
 * These win conditions decide what every observation records, and a wrong one
 * fails silently: the engine keeps producing confident numbers built on
 * mis-settled history. Cheap to test, expensive to get wrong.
 */

const o = (
  homeGoals: number,
  awayGoals: number,
  extra: Partial<MatchOutcome> = {},
): MatchOutcome => ({ homeGoals, awayGoals, ...extra });

describe('market definitions', () => {
  it('has no duplicate market ids', () => {
    const ids = MARKET_DEFINITIONS.map((m) => m.marketId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('declares selections and required stats for every market', () => {
    for (const m of MARKET_DEFINITIONS) {
      expect(m.selections.length).toBeGreaterThan(0);
      expect(m.requires.length).toBeGreaterThan(0);
    }
  });

  it('never returns an outcome outside the allowed set', () => {
    const full = o(1, 0, {
      homeCorners: 5,
      awayCorners: 5,
      homeYellowCards: 2,
      awayYellowCards: 2,
    });
    for (const m of MARKET_DEFINITIONS) {
      for (const side of m.selections) {
        expect(['WIN', 'LOSS', 'VOID', 'UNKNOWN']).toContain(m.evaluate(full, side));
      }
    }
  });
});

describe('evaluators', () => {
  const cases: Array<[string, Selection, MatchOutcome, Outcome]> = [
    // Arsenal 2-1 Chelsea — one result, many markets
    ['TEAM_OVER_0_5', 'HOME', o(2, 1), 'WIN'],
    ['TEAM_OVER_1_5', 'HOME', o(2, 1), 'WIN'],
    ['TEAM_OVER_2_5', 'HOME', o(2, 1), 'LOSS'],
    ['TEAM_OVER_0_5', 'AWAY', o(2, 1), 'WIN'],
    ['TEAM_OVER_1_5', 'AWAY', o(2, 1), 'LOSS'],
    ['MATCH_OVER_1_5', 'MATCH', o(2, 1), 'WIN'],
    ['MATCH_OVER_2_5', 'MATCH', o(2, 1), 'WIN'],
    ['MATCH_OVER_3_5', 'MATCH', o(2, 1), 'LOSS'],
    ['BTTS_YES', 'MATCH', o(2, 1), 'WIN'],
    ['BTTS_NO', 'MATCH', o(2, 1), 'LOSS'],
    ['TEAM_WIN', 'HOME', o(2, 1), 'WIN'],
    ['DRAW_NO_BET', 'HOME', o(2, 1), 'WIN'],
    ['DRAW_NO_BET', 'AWAY', o(2, 1), 'LOSS'],

    // Win to nil — No. 1-0 IS a win to nil, so "No" loses.
    ['TEAM_WIN_TO_NIL_NO', 'HOME', o(2, 1), 'WIN'],
    ['TEAM_WIN_TO_NIL_NO', 'HOME', o(1, 0), 'LOSS'],
    ['TEAM_WIN_TO_NIL_NO', 'HOME', o(0, 0), 'WIN'],
    ['TEAM_WIN_TO_NIL_NO', 'HOME', o(0, 1), 'WIN'],
    ['TEAM_WIN_TO_NIL_NO', 'AWAY', o(0, 3), 'LOSS'],

    // A draw voids Draw No Bet — it is not a loss
    ['DRAW_NO_BET', 'HOME', o(1, 1), 'VOID'],

    // Goalless
    ['TEAM_UNDER_0_5', 'HOME', o(0, 0), 'WIN'],
    ['TEAM_UNDER_1_5', 'AWAY', o(0, 0), 'WIN'],
    ['MATCH_UNDER_2_5', 'MATCH', o(0, 0), 'WIN'],
    ['MATCH_UNDER_3_5', 'MATCH', o(2, 1), 'WIN'],

    // Opponent-facing
    ['OPPONENT_UNDER_1_5', 'HOME', o(3, 1), 'WIN'],
    ['OPPONENT_UNDER_1_5', 'HOME', o(3, 2), 'LOSS'],

    // Double chance
    ['DOUBLE_CHANCE_TEAM_OR_DRAW', 'AWAY', o(1, 1), 'WIN'],
    ['DOUBLE_CHANCE_TEAM_OR_DRAW', 'AWAY', o(2, 1), 'LOSS'],
    ['DOUBLE_CHANCE_HOME_OR_AWAY', 'MATCH', o(1, 1), 'LOSS'],
    ['HOME_OR_AWAY_AND_OVER_2_5', 'MATCH', o(2, 1), 'WIN'],
    ['HOME_OR_AWAY_AND_OVER_2_5', 'MATCH', o(2, 2), 'LOSS'],

    // Asian handicaps on half lines — no push possible
    ['AH_MINUS_1_5', 'HOME', o(2, 0), 'WIN'],
    ['AH_MINUS_1_5', 'HOME', o(1, 0), 'LOSS'],
    ['AH_PLUS_1_5', 'AWAY', o(2, 1), 'WIN'],
    ['AH_PLUS_1_5', 'AWAY', o(3, 1), 'LOSS'],
    ['AH_PLUS_2_5', 'AWAY', o(3, 1), 'WIN'],
    ['AH_MINUS_2_5', 'HOME', o(3, 0), 'WIN'],

    // Corners
    ['MATCH_CORNERS_OVER_8_5', 'MATCH', o(0, 0, { homeCorners: 5, awayCorners: 4 }), 'WIN'],
    ['MATCH_CORNERS_OVER_8_5', 'MATCH', o(0, 0, { homeCorners: 4, awayCorners: 4 }), 'LOSS'],
    ['MATCH_CORNERS_OVER_10_5', 'MATCH', o(0, 0, { homeCorners: 6, awayCorners: 5 }), 'WIN'],
    ['TEAM_CORNERS_OVER_4_5', 'AWAY', o(0, 0, { homeCorners: 9, awayCorners: 5 }), 'WIN'],

    // Cards
    ['MATCH_CARDS_OVER_3_5', 'MATCH', o(0, 0, { homeYellowCards: 2, awayYellowCards: 2 }), 'WIN'],
    ['MATCH_CARDS_OVER_3_5', 'MATCH', o(0, 0, { homeYellowCards: 1, awayYellowCards: 2 }), 'LOSS'],
  ];

  it.each(cases)('%s [%s] settles correctly', (marketId, side, outcome, expected) => {
    const def = MARKET_BY_ID.get(marketId);
    expect(def).toBeDefined();
    expect(def!.evaluate(outcome, side)).toBe(expected);
  });

  // Missing inputs must never be guessed: an invented zero would drag the
  // baseline for that market down for every team.
  const missing: Array<[string, Selection]> = [
    ['MATCH_CORNERS_OVER_8_5', 'MATCH'],
    ['MATCH_CORNERS_OVER_10_5', 'MATCH'],
    ['TEAM_CORNERS_OVER_4_5', 'HOME'],
    ['MATCH_CARDS_OVER_3_5', 'MATCH'],
  ];

  it.each(missing)('%s [%s] is UNKNOWN when its stats are absent', (marketId, side) => {
    const def = MARKET_BY_ID.get(marketId)!;
    expect(def.evaluate(o(1, 1), side)).toBe('UNKNOWN');
  });
});
