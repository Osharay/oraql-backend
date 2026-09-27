/**
 * Team ratings from results alone.
 *
 * An Elo rating: every team starts level, each result moves both sides by how
 * surprising it was, and a win by several goals counts for more than a win by
 * one. After a few matches the number says who is strong, average or weak in
 * any league — or any sport with a winner — without anyone having to know the
 * teams. That is the point: the client's eye for "a strong side meeting a weak
 * one" has to come from the data if OraQL is to work where nobody knows the
 * league.
 *
 * Everything here is pure; RatingsService reads the matches and stores the
 * result.
 */

export const START_RATING = 1500;
/** How far one match can move a rating. */
export const K = 20;
/** Faster for a team's first matches, and after it changes league. */
export const K_SETTLING = 30;
export const SETTLING_MATCHES = 10;
/** Home advantage, in rating points. */
export const HOME_ADVANTAGE = 60;

/**
 * Where a team starts in a new league, relative to that league's average.
 * A relegated side is usually among the stronger teams below; a promoted one
 * among the weaker above. Results take over within a few matches.
 */
export const RELEGATED_START = 75;
export const PROMOTED_START = -50;

/** The home side's expected score (win = 1, draw = ½). */
export function expectedHome(home: number, away: number, homeAdvantage = HOME_ADVANTAGE): number {
  return 1 / (1 + Math.pow(10, (away - (home + homeAdvantage)) / 400));
}

/** A two-goal win counts half as much again as a one-goal win; bigger ones more. */
export function goalMultiplier(goalDifference: number): number {
  const n = Math.abs(goalDifference);
  if (n <= 1) return 1;
  if (n === 2) return 1.5;
  return (11 + n) / 8;
}

export interface RatedMatch {
  id: string;
  kickoffAt: Date;
  leagueId: string;
  /** League matches decide which league a team is in; cup matches do not. */
  isLeague: boolean;
  homeTeamId: string;
  awayTeamId: string;
  homeGoals: number;
  awayGoals: number;
}

export interface TeamRating {
  rating: number;
  matches: number;
  /** The league of its most recent league match. */
  leagueId: string | null;
  /** Matches since it last settled (start, or a change of league). */
  settling: number;
}

export interface ReplayResult {
  ratings: Map<string, TeamRating>;
  /** Each match's ratings going in: [home, away]. */
  before: Map<string, [number, number]>;
}

const YEAR_MS = 365 * 86_400_000;

/**
 * Play every match in kickoff order. Matches must already be sorted.
 */
export function replay(matches: RatedMatch[]): ReplayResult {
  const ratings = new Map<string, TeamRating>();
  const before = new Map<string, [number, number]>();
  // Recent league results per league, for averages and for telling a
  // relegated side from a promoted one.
  const recent = new Map<string, RatedMatch[]>();

  const leagueMean = (leagueId: string, exclude: string): number | null => {
    let sum = 0;
    let n = 0;
    for (const [id, r] of ratings) {
      if (id !== exclude && r.leagueId === leagueId) {
        sum += r.rating;
        n++;
      }
    }
    return n >= 4 ? sum / n : null;
  };

  const arrive = (teamId: string, m: RatedMatch): TeamRating => {
    const existing = ratings.get(teamId);
    if (!existing) {
      const mean = m.isLeague ? leagueMean(m.leagueId, teamId) : null;
      const r: TeamRating = { rating: mean ?? START_RATING, matches: 0, leagueId: null, settling: 0 };
      ratings.set(teamId, r);
      return r;
    }
    if (m.isLeague && existing.leagueId && existing.leagueId !== m.leagueId) {
      const mean = leagueMean(m.leagueId, teamId);
      if (mean != null) {
        const upper = finishedInUpperHalf(teamId, recent.get(existing.leagueId) ?? [], m.kickoffAt);
        if (upper != null) {
          // Top half of the old league: promoted into this one. Bottom half:
          // relegated into it.
          existing.rating = mean + (upper ? PROMOTED_START : RELEGATED_START);
          existing.settling = 0;
        }
      }
    }
    return existing;
  };

  for (const m of matches) {
    const home = arrive(m.homeTeamId, m);
    const away = arrive(m.awayTeamId, m);
    before.set(m.id, [home.rating, away.rating]);

    const expected = expectedHome(home.rating, away.rating);
    const actual = m.homeGoals > m.awayGoals ? 1 : m.homeGoals === m.awayGoals ? 0.5 : 0;
    const k = (r: TeamRating) => (r.settling < SETTLING_MATCHES ? K_SETTLING : K);
    const g = goalMultiplier(m.homeGoals - m.awayGoals);
    const shift = (actual - expected) * g;

    home.rating += k(home) * shift;
    away.rating -= k(away) * shift;
    for (const r of [home, away]) {
      r.matches++;
      r.settling++;
      if (m.isLeague) r.leagueId = m.leagueId;
    }

    if (m.isLeague) {
      const list = recent.get(m.leagueId) ?? [];
      list.push(m);
      // A year of results is enough to rank a league; drop the rest.
      while (list.length && m.kickoffAt.getTime() - list[0].kickoffAt.getTime() > YEAR_MS) list.shift();
      recent.set(m.leagueId, list);
    }
  }

  return { ratings, before };
}

/**
 * Whether a team finished its last year in a league in the top half by points
 * per game. Null when it played too little there to say.
 */
export function finishedInUpperHalf(teamId: string, leagueMatches: RatedMatch[], asOf: Date): boolean | null {
  const table = new Map<string, { points: number; played: number }>();
  const add = (id: string, points: number) => {
    const row = table.get(id) ?? { points: 0, played: 0 };
    row.points += points;
    row.played += 1;
    table.set(id, row);
  };
  for (const m of leagueMatches) {
    if (asOf.getTime() - m.kickoffAt.getTime() > YEAR_MS) continue;
    const [h, a] = m.homeGoals > m.awayGoals ? [3, 0] : m.homeGoals === m.awayGoals ? [1, 1] : [0, 3];
    add(m.homeTeamId, h);
    add(m.awayTeamId, a);
  }
  const mine = table.get(teamId);
  if (!mine || mine.played < 8) return null;
  const ppg = [...table.values()].filter((r) => r.played >= 8).map((r) => r.points / r.played).sort((x, y) => y - x);
  // A table of two or three is not a league position.
  if (ppg.length < 4) return null;
  const rank = ppg.indexOf(mine.points / mine.played);
  return rank < ppg.length / 2;
}

export type StrengthTier = 'STRONG' | 'AVERAGE' | 'WEAK';

/**
 * Thirds of each league by rating. Leagues with fewer than six rated teams
 * get no tiers — a third of four teams is not a group.
 */
export function leagueTiers(ratings: Map<string, TeamRating>): Map<string, StrengthTier> {
  const byLeague = new Map<string, Array<[string, number]>>();
  for (const [id, r] of ratings) {
    if (!r.leagueId) continue;
    const list = byLeague.get(r.leagueId) ?? [];
    list.push([id, r.rating]);
    byLeague.set(r.leagueId, list);
  }
  const tiers = new Map<string, StrengthTier>();
  for (const list of byLeague.values()) {
    if (list.length < 6) continue;
    list.sort((a, b) => b[1] - a[1]);
    list.forEach(([id], i) => {
      const f = i / list.length;
      tiers.set(id, f < 1 / 3 ? 'STRONG' : f < 2 / 3 ? 'AVERAGE' : 'WEAK');
    });
  }
  return tiers;
}

/**
 * How the two sides compare going into a match, in rating points and as the
 * home side's win-or-draw-weighted expectation. Used on the fixture line and,
 * later, to split a team's record by the strength of who it played.
 */
export function compareSides(home: number, away: number) {
  const diff = home + HOME_ADVANTAGE - away;
  return {
    difference: Math.round(diff),
    homeExpectation: expectedHome(home, away),
    stronger: Math.abs(diff) < 35 ? ('EVEN' as const) : diff > 0 ? ('HOME' as const) : ('AWAY' as const),
  };
}
