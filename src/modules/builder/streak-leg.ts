/**
 * Turning a streak into a Bet Builder selection.
 *
 * The builder holds markets (one row per selection on a fixture). Streaks and
 * clusters speak in market definitions — "TEAM_OVER_1_5 for the away side" —
 * so a streak is first matched to the model's own market for that fixture
 * where one exists (same name, so the builder's conflict checks and the
 * model's probability apply), and otherwise given a market row of its own,
 * marked as coming from a streak so a model recompute never removes it.
 */

export type LegSide = 'HOME' | 'AWAY' | 'MATCH';

/**
 * The model's market name for this definition and side, when the model
 * publishes one. Null when it does not — halves, handicaps, combos.
 */
export function modelMarketName(
  marketId: string,
  side: LegSide,
  teams: { home: string; away: string },
): string | null {
  const id = marketId.toUpperCase();
  const team = side === 'HOME' ? teams.home : side === 'AWAY' ? teams.away : null;
  const line = (m: RegExpExecArray) => m[2].replace('_', '.');

  let m = /^MATCH_(OVER|UNDER)_(\d+_\d+)$/.exec(id);
  if (m) return `Match Goals: ${m[1] === 'OVER' ? 'Over' : 'Under'} ${line(m)}`;

  m = /^TEAM_(OVER|UNDER)_(\d+_\d+)$/.exec(id);
  if (m && team) return `${team} Goals: ${m[1] === 'OVER' ? 'Over' : 'Under'} ${line(m)}`;

  m = /^MATCH_(CORNERS|CARDS)_OVER_(\d+_\d+)$/.exec(id);
  if (m) return `Match ${m[1] === 'CORNERS' ? 'Corners' : 'Cards'}: Over ${line(m)}`;

  if (id === 'BTTS_YES') return 'Both Teams to Score — Yes';
  if (id === 'BTTS_NO') return 'Both Teams to Score — No';
  if (id === 'TEAM_WIN' && team) return `${team} to Win`;
  if (id === 'DRAW') return 'Draw';
  return null;
}

/** Which side of the fixture a streak's selection is on. */
export function legSide(
  scope: 'TEAM' | 'MATCH',
  teamId: string | null | undefined,
  event: { homeTeamId: string; awayTeamId: string },
): LegSide | null {
  if (scope === 'MATCH') return 'MATCH';
  if (teamId === event.homeTeamId) return 'HOME';
  if (teamId === event.awayTeamId) return 'AWAY';
  return null;
}

/** A chance the builder can multiply: a record is never treated as certain. */
export function legProbability(p: number): number {
  if (!Number.isFinite(p)) return 0.5;
  return Math.min(0.97, Math.max(0.03, p));
}
