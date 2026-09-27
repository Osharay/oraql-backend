/**
 * A team's record in one market, split by how strong the opponent was at the
 * time — the client's point that a run built against weak sides says little
 * about the next match against a strong one.
 *
 * Strength comes from the team ratings each match stored going in, so the
 * split is by who the opponent was then, not by where it sits now.
 */

export type OpponentBand = 'STRONGER' | 'SIMILAR' | 'WEAKER';

/**
 * Rating points either side of level that still count as a similar opponent.
 * 50 points is roughly a 57–43 expectation on neutral ground.
 */
export const SIMILAR_WITHIN = 50;

export function bandOf(teamRating: number, opponentRating: number): OpponentBand {
  const diff = opponentRating - teamRating;
  if (diff > SIMILAR_WITHIN) return 'STRONGER';
  if (diff < -SIMILAR_WITHIN) return 'WEAKER';
  return 'SIMILAR';
}

export interface BandRecord {
  wins: number;
  played: number;
}

export interface OpponentSplit {
  stronger: BandRecord;
  similar: BandRecord;
  weaker: BandRecord;
  /** Matches with no rating on either side (before ratings reached them). */
  unrated: number;
  /** The next opponent's band, when both sides are rated. */
  next?: OpponentBand | null;
}

export function splitByOpponent(
  rows: Array<{ result: string; teamRating: number | null; opponentRating: number | null }>,
): OpponentSplit {
  const split: OpponentSplit = {
    stronger: { wins: 0, played: 0 },
    similar: { wins: 0, played: 0 },
    weaker: { wins: 0, played: 0 },
    unrated: 0,
  };
  for (const r of rows) {
    if (r.result !== 'WIN' && r.result !== 'LOSS') continue;
    if (r.teamRating == null || r.opponentRating == null) {
      split.unrated++;
      continue;
    }
    const band = bandOf(r.teamRating, r.opponentRating);
    const rec = band === 'STRONGER' ? split.stronger : band === 'WEAKER' ? split.weaker : split.similar;
    rec.played++;
    if (r.result === 'WIN') rec.wins++;
  }
  return split;
}

/** Which side of a stored match the team was on, and so whose rating is whose. */
export function sidesFor(
  teamIsHome: boolean,
  homeRatingBefore: number | null,
  awayRatingBefore: number | null,
): { teamRating: number | null; opponentRating: number | null } {
  return teamIsHome
    ? { teamRating: homeRatingBefore, opponentRating: awayRatingBefore }
    : { teamRating: awayRatingBefore, opponentRating: homeRatingBefore };
}
