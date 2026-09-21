import { MARKET_DEFINITIONS, MARKET_BY_ID, MatchOutcome, Selection } from './market-definitions';
import { nextRevision } from './observation-revision';

/**
 * The extended vocabulary: half-time, second-half, across-halves, half-time/
 * full-time, and more full-time markets. A wrong evaluator settles history
 * wrongly and silently, so every one is pinned against hand-worked scorelines.
 */

const m = (
  ft: [number, number],
  ht?: [number, number],
): MatchOutcome => ({
  homeGoals: ft[0],
  awayGoals: ft[1],
  htHomeGoals: ht ? ht[0] : null,
  htAwayGoals: ht ? ht[1] : null,
});

const run = (id: string, o: MatchOutcome, side: Selection = 'MATCH') => {
  const def = MARKET_BY_ID.get(id);
  if (!def) throw new Error(`no market ${id}`);
  return def.evaluate(o, side);
};

const HALF_TIME_MARKETS = MARKET_DEFINITIONS.filter((d) => d.requires.includes('halftime'));

describe('extended market registry', () => {
  it('has grown past 70 markets', () => {
    expect(MARKET_DEFINITIONS.length).toBeGreaterThanOrEqual(70);
  });

  it('marks every half-based market as needing the half-time score', () => {
    for (const d of MARKET_DEFINITIONS) {
      if (/^(HT_|SH_|HTFT_|HIGHEST_SCORING_HALF|GOAL_IN_BOTH|BTTS_BOTH|TEAM_(SCORE|WIN)_(BOTH|EITHER))/.test(d.marketId)) {
        expect(d.requires).toContain('halftime');
      }
    }
  });

  it('never guesses a half-based market when no half-time score was recorded', () => {
    const noHt = m([2, 1]);
    for (const d of HALF_TIME_MARKETS) {
      for (const side of d.selections) {
        expect(d.evaluate(noHt, side as Selection)).toBe('UNKNOWN');
      }
    }
  });

  it('never returns UNKNOWN for a full-time market with a full-time score', () => {
    const full = m([2, 1], [0, 1]);
    for (const d of MARKET_DEFINITIONS) {
      if (d.requires.some((r) => r === 'corners' || r === 'cards')) continue;
      for (const side of d.selections) {
        expect(d.evaluate(full, side as Selection)).not.toBe('UNKNOWN');
      }
    }
  });
});

// A comeback: away lead 1-0 at the break, home win 2-1.
describe('comeback 2-1, away led 0-1 at half-time', () => {
  const o = m([2, 1], [0, 1]);

  it.each([
    ['HT_TEAM_WIN', 'HOME', 'LOSS'],
    ['HT_TEAM_WIN', 'AWAY', 'WIN'],
    ['HT_DRAW', 'MATCH', 'LOSS'],
    ['HT_DOUBLE_CHANCE_TEAM_OR_DRAW', 'HOME', 'LOSS'],
    ['HT_DOUBLE_CHANCE_TEAM_OR_DRAW', 'AWAY', 'WIN'],
    ['HT_OVER_0_5', 'MATCH', 'WIN'],
    ['HT_OVER_1_5', 'MATCH', 'LOSS'],
    ['HT_UNDER_0_5', 'MATCH', 'LOSS'],
    ['HT_UNDER_1_5', 'MATCH', 'WIN'],
    ['HT_BTTS_YES', 'MATCH', 'LOSS'],
    ['HT_BTTS_NO', 'MATCH', 'WIN'],
    ['HT_TEAM_OVER_0_5', 'HOME', 'LOSS'],
    ['HT_TEAM_OVER_0_5', 'AWAY', 'WIN'],
    ['HT_TEAM_UNDER_0_5', 'HOME', 'WIN'],
    // second half finished 2-0 to home
    ['SH_TEAM_WIN', 'HOME', 'WIN'],
    ['SH_TEAM_WIN', 'AWAY', 'LOSS'],
    ['SH_DRAW', 'MATCH', 'LOSS'],
    ['SH_OVER_0_5', 'MATCH', 'WIN'],
    ['SH_OVER_1_5', 'MATCH', 'WIN'],
    ['SH_UNDER_1_5', 'MATCH', 'LOSS'],
    ['SH_BTTS_YES', 'MATCH', 'LOSS'],
    ['SH_TEAM_OVER_0_5', 'HOME', 'WIN'],
    ['SH_TEAM_OVER_0_5', 'AWAY', 'LOSS'],
    ['TEAM_SCORE_BOTH_HALVES', 'HOME', 'LOSS'],
    ['TEAM_SCORE_BOTH_HALVES', 'AWAY', 'LOSS'],
    ['TEAM_WIN_EITHER_HALF', 'HOME', 'WIN'],
    ['TEAM_WIN_EITHER_HALF', 'AWAY', 'WIN'],
    ['TEAM_WIN_BOTH_HALVES', 'HOME', 'LOSS'],
    ['TEAM_WIN_BOTH_HALVES', 'AWAY', 'LOSS'],
    ['GOAL_IN_BOTH_HALVES', 'MATCH', 'WIN'],
    ['BTTS_BOTH_HALVES', 'MATCH', 'LOSS'],
    ['HIGHEST_SCORING_HALF_FIRST', 'MATCH', 'LOSS'],
    ['HIGHEST_SCORING_HALF_SECOND', 'MATCH', 'WIN'],
    ['HTFT_TEAM_TEAM', 'HOME', 'LOSS'],
    ['HTFT_TEAM_TEAM', 'AWAY', 'LOSS'],
    ['HTFT_DRAW_TEAM', 'HOME', 'LOSS'],
    ['HTFT_DRAW_DRAW', 'MATCH', 'LOSS'],
    // full-time extended
    ['DRAW', 'MATCH', 'LOSS'],
    ['TEAM_WIN_TO_NIL_YES', 'HOME', 'LOSS'],
    ['TEAM_WIN_BY_EXACTLY_1', 'HOME', 'WIN'],
    ['TEAM_WIN_BY_EXACTLY_1', 'AWAY', 'LOSS'],
    ['TEAM_CLEAN_SHEET_YES', 'HOME', 'LOSS'],
    ['TEAM_CLEAN_SHEET_NO', 'HOME', 'WIN'],
    ['TEAM_UNDER_2_5', 'HOME', 'WIN'],
    ['TEAM_WIN_AND_OVER_1_5', 'HOME', 'WIN'],
    ['TEAM_WIN_AND_OVER_1_5', 'AWAY', 'LOSS'],
    ['TEAM_WIN_AND_BTTS', 'HOME', 'WIN'],
    ['BTTS_AND_OVER_2_5', 'MATCH', 'WIN'],
    ['MATCH_UNDER_1_5', 'MATCH', 'LOSS'],
    ['MATCH_OVER_4_5', 'MATCH', 'LOSS'],
    ['MATCH_UNDER_4_5', 'MATCH', 'WIN'],
    ['TOTAL_GOALS_2_OR_3', 'MATCH', 'WIN'],
    ['TOTAL_GOALS_ODD', 'MATCH', 'WIN'],
    ['TOTAL_GOALS_EVEN', 'MATCH', 'LOSS'],
  ] as Array<[string, Selection, string]>)('%s (%s) → %s', (id, side, want) => {
    expect(run(id, o, side)).toBe(want);
  });
});

describe('0-0, goalless at half-time', () => {
  const o = m([0, 0], [0, 0]);

  it.each([
    ['TOTAL_GOALS_EVEN', 'MATCH', 'WIN'],
    ['TOTAL_GOALS_ODD', 'MATCH', 'LOSS'],
    ['HTFT_DRAW_DRAW', 'MATCH', 'WIN'],
    ['HT_UNDER_0_5', 'MATCH', 'WIN'],
    ['DRAW', 'MATCH', 'WIN'],
    // equal halves: bookmakers price the tie separately, so both sides lose
    ['HIGHEST_SCORING_HALF_FIRST', 'MATCH', 'LOSS'],
    ['HIGHEST_SCORING_HALF_SECOND', 'MATCH', 'LOSS'],
    ['TEAM_CLEAN_SHEET_YES', 'HOME', 'WIN'],
    ['TEAM_WIN_TO_NIL_YES', 'HOME', 'LOSS'],
  ] as Array<[string, Selection, string]>)('%s (%s) → %s', (id, side, want) => {
    expect(run(id, o, side)).toBe(want);
  });
});

describe('1-0, led 1-0 at half-time, goalless second half', () => {
  const o = m([1, 0], [1, 0]);

  it.each([
    ['HTFT_TEAM_TEAM', 'HOME', 'WIN'],
    ['TEAM_WIN_TO_NIL_YES', 'HOME', 'WIN'],
    ['TEAM_WIN_BOTH_HALVES', 'HOME', 'LOSS'],
    ['TEAM_WIN_EITHER_HALF', 'HOME', 'WIN'],
    ['SH_DRAW', 'MATCH', 'WIN'],
    ['SH_OVER_0_5', 'MATCH', 'LOSS'],
    ['HIGHEST_SCORING_HALF_FIRST', 'MATCH', 'WIN'],
    ['TEAM_WIN_AND_OVER_1_5', 'HOME', 'LOSS'],
  ] as Array<[string, Selection, string]>)('%s (%s) → %s', (id, side, want) => {
    expect(run(id, o, side)).toBe(want);
  });
});

describe('level at the break, then a winner', () => {
  it('settles Draw/Team for the side that went on to win', () => {
    const o = m([1, 0], [0, 0]);
    expect(run('HTFT_DRAW_TEAM', o, 'HOME')).toBe('WIN');
    expect(run('HTFT_DRAW_TEAM', o, 'AWAY')).toBe('LOSS');
  });

  it('wins both halves only when each half is won outright', () => {
    const o = m([3, 0], [1, 0]);
    expect(run('TEAM_WIN_BOTH_HALVES', o, 'HOME')).toBe('WIN');
    expect(run('TEAM_SCORE_BOTH_HALVES', o, 'HOME')).toBe('WIN');
  });

  it('needs every side to score in each half for BTTS in both halves', () => {
    expect(run('BTTS_BOTH_HALVES', m([2, 2], [1, 1]))).toBe('WIN');
    expect(run('BTTS_BOTH_HALVES', m([2, 1], [1, 1]))).toBe('LOSS');
  });
});

describe('nextRevision', () => {
  it('writes revision 1 when nothing is recorded', () => {
    expect(nextRevision(undefined, 'WIN')).toBe(1);
    expect(nextRevision(undefined, 'UNKNOWN')).toBe(1);
  });

  it('upgrades an UNKNOWN once the result can be settled', () => {
    expect(nextRevision({ result: 'UNKNOWN', revision: 1 }, 'WIN')).toBe(2);
    expect(nextRevision({ result: 'UNKNOWN', revision: 2 }, 'LOSS')).toBe(3);
  });

  it('writes nothing while the result is still unknowable', () => {
    expect(nextRevision({ result: 'UNKNOWN', revision: 1 }, 'UNKNOWN')).toBeNull();
  });

  // Readers count WIN/LOSS across all revisions. Revising a settled result
  // would count the match twice.
  it('never revises a settled result', () => {
    expect(nextRevision({ result: 'WIN', revision: 1 }, 'LOSS')).toBeNull();
    expect(nextRevision({ result: 'LOSS', revision: 1 }, 'WIN')).toBeNull();
    expect(nextRevision({ result: 'VOID', revision: 1 }, 'WIN')).toBeNull();
  });
});
