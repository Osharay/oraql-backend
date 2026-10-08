/**
 * Streak picks on the same match that cannot both land.
 *
 * Each team's streaks are found on its own record, so a match can turn up
 * "CRB leads at half-time and wins" and "Atletico leads at half-time and
 * wins" side by side. Shown together they read as guessing; OraQL shows the
 * one with the higher honest chance. Both are still found and stored.
 *
 * A pick is its market and, for a team market, the team. Add a new market's
 * opposites here when it is added to the registry.
 */

export interface PickRef {
  marketId: string;
  /** The team a team market is about; null for a match-wide market. */
  team: string | null;
}

/** Full-time: the team wins (in any form that needs it to). */
const FT_WIN = new Set([
  'TEAM_WIN',
  'HTFT_TEAM_TEAM',
  'HTFT_DRAW_TEAM',
  'TEAM_WIN_TO_NIL_YES',
  'TEAM_WIN_AND_OVER_1_5',
  'TEAM_WIN_AND_BTTS',
  'TEAM_WIN_BY_EXACTLY_1',
  'TEAM_WIN_BOTH_HALVES',
  'AH_MINUS_1_5',
  'AH_MINUS_2_5',
]);
const FT_DRAW = new Set(['DRAW', 'HTFT_DRAW_DRAW']);
/** Full-time: the team does not lose. */
const FT_NOT_LOSE = new Set(['DOUBLE_CHANCE_TEAM_OR_DRAW', 'DRAW_NO_BET', 'AH_PLUS_1_5', 'AH_PLUS_2_5']);
/** Half-time: the team leads. */
const HT_WIN = new Set(['HT_TEAM_WIN', 'HTFT_TEAM_TEAM']);
const HT_DRAW = new Set(['HT_DRAW', 'HTFT_DRAW_DRAW', 'HTFT_DRAW_TEAM']);

/** Pairs of match-wide markets that are each other's opposite. */
const OPPOSITES: Array<[string, string]> = [
  ['BTTS_YES', 'BTTS_NO'],
  ['HT_BTTS_YES', 'HT_BTTS_NO'],
  ['TOTAL_GOALS_ODD', 'TOTAL_GOALS_EVEN'],
  ['HIGHEST_SCORING_HALF_FIRST', 'HIGHEST_SCORING_HALF_SECOND'],
];
/** Pairs of markets on the same team that are each other's opposite. */
const SAME_TEAM_OPPOSITES: Array<[string, string]> = [
  ['TEAM_CLEAN_SHEET_YES', 'TEAM_CLEAN_SHEET_NO'],
  ['TEAM_WIN_TO_NIL_YES', 'TEAM_WIN_TO_NIL_NO'],
];

const isPair = (pairs: Array<[string, string]>, a: string, b: string) =>
  pairs.some(([x, y]) => (x === a && y === b) || (x === b && y === a));

const TOTAL = /^(MATCH|TEAM|HT|SH|HT_TEAM|SH_TEAM)_(OVER|UNDER)_(\d+)_(\d+)$/;

/** Whether two picks on the same match cannot both land. */
export function contradicts(a: PickRef, b: PickRef): boolean {
  const A = a.marketId.toUpperCase();
  const B = b.marketId.toUpperCase();
  const otherTeams = a.team != null && b.team != null && a.team !== b.team;
  const sameTeam = a.team != null && a.team === b.team;

  // Who wins: two different winners, or a winner and a draw.
  const resultClash = (win: Set<string>, draw: Set<string>) =>
    (win.has(A) && win.has(B) && otherTeams) || (win.has(A) && draw.has(B)) || (win.has(B) && draw.has(A));
  if (resultClash(FT_WIN, FT_DRAW) || resultClash(HT_WIN, HT_DRAW)) return true;
  if (otherTeams && ((FT_WIN.has(A) && FT_NOT_LOSE.has(B)) || (FT_WIN.has(B) && FT_NOT_LOSE.has(A)))) return true;

  if (isPair(OPPOSITES, A, B)) return true;
  if (sameTeam && isPair(SAME_TEAM_OPPOSITES, A, B)) return true;

  // A clean sheet against the other side scoring, or against both scoring.
  const cleanSheet = (x: string) => x === 'TEAM_CLEAN_SHEET_YES' || x === 'TEAM_WIN_TO_NIL_YES';
  if (otherTeams && ((cleanSheet(A) && B === 'TEAM_OVER_0_5') || (cleanSheet(B) && A === 'TEAM_OVER_0_5'))) return true;
  const blank = (x: string) => x === 'TEAM_UNDER_0_5';
  if ((cleanSheet(A) || blank(A)) && B === 'BTTS_YES') return true;
  if ((cleanSheet(B) || blank(B)) && A === 'BTTS_YES') return true;

  // Over and under on the same count, where the lines leave no room for both.
  const ta = TOTAL.exec(A);
  const tb = TOTAL.exec(B);
  if (ta && tb && ta[1] === tb[1] && ta[2] !== tb[2]) {
    const teamMarket = ta[1].includes('TEAM');
    if (teamMarket && !sameTeam) return false;
    const line = (m: RegExpExecArray) => Number(`${m[3]}.${m[4]}`);
    const over = ta[2] === 'OVER' ? line(ta) : line(tb);
    const under = ta[2] === 'UNDER' ? line(ta) : line(tb);
    if (under <= over) return true;
  }
  return false;
}

/**
 * Keep, on each match, only picks that do not contradict a likelier one. The
 * order of what is kept is unchanged. Picks with no match pass through.
 */
export function dropContradictions<T>(
  items: T[],
  eventOf: (t: T) => string | null | undefined,
  refOf: (t: T) => PickRef,
  chanceOf: (t: T) => number,
): T[] {
  const byEvent = new Map<string, T[]>();
  for (const t of items) {
    const e = eventOf(t);
    if (!e) continue;
    byEvent.set(e, [...(byEvent.get(e) ?? []), t]);
  }
  const dropped = new Set<T>();
  for (const group of byEvent.values()) {
    if (group.length < 2) continue;
    const kept: T[] = [];
    for (const t of [...group].sort((x, y) => chanceOf(y) - chanceOf(x))) {
      if (kept.some((k) => contradicts(refOf(k), refOf(t)))) dropped.add(t);
      else kept.push(t);
    }
  }
  return items.filter((t) => !dropped.has(t));
}
