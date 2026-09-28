/**
 * Who is missing, and how much it matters.
 *
 * A team's record is built with its usual players. When the ones who score
 * its goals are out — injured, suspended, or simply not picked — the record
 * describes a different team. The client's example: France without Mbappé and
 * two other starting attackers, where corners and goals picks on France failed.
 *
 * Importance comes from the season's numbers for the player's current club:
 * his share of the team's goals plus half its assists. No names, no hand
 * lists, so it works in leagues nobody here follows and in other sports with
 * a scoring stat. Where the numbers are missing, the absence is still shown,
 * marked as of unknown weight rather than guessed at.
 *
 * Pure; the reader (availability.reader.ts) gathers the rows.
 */

export interface SquadPlayer {
  id: string;
  name: string;
  position?: string | null;
  goals?: number | null;
  assists?: number | null;
}

export interface AbsenceIn {
  playerId: string;
  status: string; // 'Out' | 'Doubtful' | 'Day-to-Day'
  reason?: string | null;
}

export interface LineupIn {
  starters: string[]; // player ids
}

export type AvailabilityLevel = 'NONE' | 'MINOR' | 'MAJOR' | 'UNKNOWN';

export interface MissingPlayer {
  playerId: string;
  name: string;
  status: string;
  reason: string | null;
  /** Share of the team's goal involvement this season; null when unknown. */
  share: number | null;
  /** 'ABSENT' from the injury list, 'BENCHED' from a confirmed lineup. */
  kind: 'ABSENT' | 'BENCHED';
}

export interface Availability {
  level: AvailabilityLevel;
  /** Weighted share of the team's goal involvement not available. */
  lostShare: number;
  missing: MissingPlayer[];
  lineupConfirmed: boolean;
  /** Whether the squad has scoring numbers to weigh absences by. */
  statsKnown: boolean;
}

/** Below this much goal involvement in the squad, shares mean little. */
export const MIN_TEAM_INVOLVEMENT = 3;
/** A player at or above this share is a key contributor. */
export const KEY_SHARE = 0.1;
/** Losing this much of the team's goal involvement is major… */
export const MAJOR_LOSS = 0.25;
/** …as is losing its top contributor when he carries this much alone. */
export const TOP_SHARE = 0.2;
export const MINOR_LOSS = 0.1;

const involvement = (p: SquadPlayer) => (p.goals ?? 0) + 0.5 * (p.assists ?? 0);

/** Each player's share of the squad's goals-plus-half-assists. Null if too little to rank. */
export function contributionShares(squad: SquadPlayer[]): Map<string, number> | null {
  const total = squad.reduce((n, p) => n + involvement(p), 0);
  if (total < MIN_TEAM_INVOLVEMENT) return null;
  return new Map(squad.map((p) => [p.id, involvement(p) / total]));
}

export function statusWeight(status: string): number {
  const s = (status || '').toLowerCase();
  if (s === 'out') return 1;
  if (s === 'doubtful') return 0.5;
  if (s.includes('day')) return 0.25;
  return 0.5;
}

export function summariseAvailability(
  squad: SquadPlayer[],
  absences: AbsenceIn[],
  lineup: LineupIn | null,
): Availability {
  const shares = contributionShares(squad);
  const byId = new Map(squad.map((p) => [p.id, p]));
  const absentIds = new Set(absences.map((a) => a.playerId));

  const missing: MissingPlayer[] = absences.map((a) => ({
    playerId: a.playerId,
    name: byId.get(a.playerId)?.name ?? 'Unknown player',
    status: a.status,
    reason: a.reason ?? null,
    share: shares ? (shares.get(a.playerId) ?? 0) : null,
    kind: 'ABSENT',
  }));

  // With a confirmed XI, a key contributor who is fit but not starting is as
  // missing as an injured one for most of the match.
  if (lineup && shares) {
    const starting = new Set(lineup.starters);
    for (const [id, share] of shares) {
      if (share >= KEY_SHARE && !starting.has(id) && !absentIds.has(id)) {
        missing.push({ playerId: id, name: byId.get(id)?.name ?? 'Unknown player', status: 'Not starting', reason: null, share, kind: 'BENCHED' });
      }
    }
  }

  missing.sort((a, b) => (b.share ?? -1) - (a.share ?? -1));

  if (!shares) {
    const anyOut = absences.some((a) => statusWeight(a.status) >= 0.5);
    return {
      level: anyOut ? 'UNKNOWN' : 'NONE',
      lostShare: 0,
      missing,
      lineupConfirmed: !!lineup,
      statsKnown: false,
    };
  }

  const lostShare = missing.reduce(
    (n, m) => n + (m.share ?? 0) * (m.kind === 'BENCHED' ? 1 : statusWeight(m.status)),
    0,
  );
  const top = [...shares.entries()].sort((a, b) => b[1] - a[1])[0];
  const topGone =
    !!top &&
    top[1] >= TOP_SHARE &&
    missing.some((m) => m.playerId === top[0] && (m.kind === 'BENCHED' || statusWeight(m.status) >= 1));

  const level: AvailabilityLevel =
    lostShare >= MAJOR_LOSS || topGone ? 'MAJOR' : lostShare >= MINOR_LOSS ? 'MINOR' : 'NONE';

  return {
    level,
    lostShare: Math.round(lostShare * 1000) / 1000,
    missing,
    lineupConfirmed: !!lineup,
    statsKnown: true,
  };
}

/**
 * Which side's attack a market depends on, and which way losing attackers
 * pushes it. HURTS: fewer goals or corners work against the pick (overs,
 * wins, "to score"). HELPS: they work for it (unders, clean sheets).
 */
export interface AbsenceBearing {
  side: 'OWN' | 'OPPONENT' | 'BOTH';
  effect: 'HURTS' | 'HELPS';
}

export function absenceBearing(marketId: string): AbsenceBearing | null {
  const m = marketId.toUpperCase();
  if (/^(TEAM_UNDER|HT_TEAM_UNDER)/.test(m)) return { side: 'OWN', effect: 'HELPS' };
  if (/^(TEAM_CLEAN_SHEET_YES|OPPONENT_UNDER)/.test(m)) return { side: 'OPPONENT', effect: 'HELPS' };
  if (/^TEAM_CLEAN_SHEET_NO/.test(m)) return { side: 'OPPONENT', effect: 'HURTS' };
  if (/^TEAM_WIN_TO_NIL_NO/.test(m)) return null;
  if (
    /^(TEAM_OVER|HT_TEAM_OVER|SH_TEAM_OVER|TEAM_SCORE_BOTH|TEAM_WIN|HT_TEAM_WIN|SH_TEAM_WIN|TEAM_CORNERS_OVER|AH_MINUS|HTFT_TEAM_TEAM)/.test(m)
  )
    return { side: 'OWN', effect: 'HURTS' };
  if (/^(MATCH_UNDER|HT_UNDER|SH_UNDER|BTTS_NO|HT_BTTS_NO)/.test(m)) return { side: 'BOTH', effect: 'HELPS' };
  if (
    /^(MATCH_OVER|BTTS_YES|BTTS_AND|BTTS_BOTH|HT_OVER|SH_OVER|GOAL_IN_BOTH|HT_BTTS_YES|SH_BTTS_YES|MATCH_CORNERS_OVER|HOME_OR_AWAY_AND_OVER)/.test(m)
  )
    return { side: 'BOTH', effect: 'HURTS' };
  return null;
}

/**
 * What a card should say about absences for its market, given each side's
 * availability. Null when nothing relevant is missing.
 */
export function absenceVerdict(
  marketId: string,
  own: Availability | null,
  opponent: Availability | null,
): { effect: 'HURTS' | 'HELPS'; level: 'MAJOR' | 'MINOR' } | null {
  const bearing = absenceBearing(marketId);
  if (!bearing) return null;
  const sides =
    bearing.side === 'OWN' ? [own] : bearing.side === 'OPPONENT' ? [opponent] : [own, opponent];
  const levels = sides.map((a) => a?.level ?? 'NONE');
  const level = levels.includes('MAJOR') ? 'MAJOR' : levels.includes('MINOR') ? 'MINOR' : null;
  return level ? { effect: bearing.effect, level } : null;
}
