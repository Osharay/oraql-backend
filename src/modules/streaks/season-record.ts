/**
 * A candidate's record in the team's current season, beside the long one.
 *
 * The long record spans two seasons, and a team can change league between
 * them: Sheffield Wednesday's 59-match sample was mostly a relegation season
 * in the Championship. A reader deserves to see whether this season agrees.
 * "Current" is the latest season the team has settled rows in.
 */
export interface SeasonRow {
  season: number;
  result: string;
}

export interface SeasonRecord {
  season: number;
  wins: number;
  played: number;
}

export function currentSeasonRecord(rows: SeasonRow[]): SeasonRecord | null {
  const settled = rows.filter((r) => r.result === 'WIN' || r.result === 'LOSS');
  if (settled.length === 0) return null;
  const season = Math.max(...settled.map((r) => r.season));
  const inSeason = settled.filter((r) => r.season === season);
  return {
    season,
    wins: inSeason.filter((r) => r.result === 'WIN').length,
    played: inSeason.length,
  };
}
