/**
 * Did the team change league at the start of its current season?
 *
 * A promoted or relegated side is, for betting purposes, a new team: new
 * opponents, often a new squad and manager. Sheffield Wednesday's record
 * was mostly a Championship relegation season; judged over that, "Wednesday
 * or draw" came out at 39% while it was 7 of 9 in League One. Pooling the
 * two seasons measures neither team.
 *
 * The league a team plays in is the competition with the most of its matches
 * that season — cups have fewer. Too few matches in the new season to tell
 * (early August, a cup tie or two) means no change is declared.
 */
export interface LeagueRow {
  eventId: string;
  leagueId: string;
  season: number;
}

export interface LeagueChange {
  /** The season the team is judged on alone. */
  season: number;
  fromLeagueId: string;
  toLeagueId: string;
}

/** Matches in the new season's league before a change is believed. */
const MIN_MATCHES_IN_NEW_LEAGUE = 3;

function mainLeague(rows: LeagueRow[], season: number): { leagueId: string; matches: number } | null {
  const events = new Map<string, Set<string>>();
  for (const r of rows) {
    if (r.season !== season) continue;
    const set = events.get(r.leagueId) ?? new Set<string>();
    set.add(r.eventId);
    events.set(r.leagueId, set);
  }
  let best: { leagueId: string; matches: number } | null = null;
  for (const [leagueId, set] of events) {
    if (!best || set.size > best.matches) best = { leagueId, matches: set.size };
  }
  return best;
}

export function detectLeagueChange(rows: LeagueRow[]): LeagueChange | null {
  if (rows.length === 0) return null;
  const seasons = [...new Set(rows.map((r) => r.season))].sort((a, b) => b - a);
  if (seasons.length < 2) return null;

  const [latest, previous] = seasons;
  const now = mainLeague(rows, latest);
  const before = mainLeague(rows, previous);
  if (!now || !before) return null;
  if (now.matches < MIN_MATCHES_IN_NEW_LEAGUE) return null;
  if (now.leagueId === before.leagueId) return null;

  return { season: latest, fromLeagueId: before.leagueId, toLeagueId: now.leagueId };
}
