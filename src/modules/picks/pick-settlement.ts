/**
 * Whether an OraQL pick landed, from the final score and match statistics.
 *
 * Reads the model's own market names (probability.service.ts): "York to Win",
 * "Draw", "Match Goals: Over 2.5", "York Goals: Under 1.5", "Match Corners:
 * Over 9.5", "Match Cards: Over 3.5", "Both Teams to Score — Yes". Anything
 * else, or a corners/cards market without statistics, is UNKNOWN: never
 * guessed.
 */

export type PickOutcome = 'WIN' | 'LOSS' | 'VOID' | 'UNKNOWN';

export interface FinalScore {
  homeGoals: number | null;
  awayGoals: number | null;
  homeCorners?: number | null;
  awayCorners?: number | null;
  /** Yellow plus red, per side. */
  homeCards?: number | null;
  awayCards?: number | null;
}

const TOTAL = /^(.+):\s+(Over|Under)\s+(\d+(?:\.\d+)?)$/;

function overUnder(value: number, side: string, line: number): PickOutcome {
  if (value === line) return 'VOID';
  const over = value > line;
  return (side === 'Over') === over ? 'WIN' : 'LOSS';
}

export function settlePick(
  marketName: string,
  score: FinalScore,
  teams: { home: string; away: string },
): PickOutcome {
  const name = marketName.trim();
  const { homeGoals: h, awayGoals: a } = score;
  if (h == null || a == null) return 'UNKNOWN';

  if (name === 'Draw') return h === a ? 'WIN' : 'LOSS';
  if (name === `${teams.home} to Win`) return h > a ? 'WIN' : 'LOSS';
  if (name === `${teams.away} to Win`) return a > h ? 'WIN' : 'LOSS';

  if (/^Both Teams to Score/i.test(name)) {
    const both = h > 0 && a > 0;
    return /Yes\s*$/i.test(name) === both ? 'WIN' : 'LOSS';
  }

  const total = TOTAL.exec(name);
  if (total) {
    const subject = total[1].trim();
    const side = total[2];
    const line = Number(total[3]);
    if (subject === 'Match Goals') return overUnder(h + a, side, line);
    if (subject === `${teams.home} Goals`) return overUnder(h, side, line);
    if (subject === `${teams.away} Goals`) return overUnder(a, side, line);
    if (subject === 'Match Corners') {
      if (score.homeCorners == null || score.awayCorners == null) return 'UNKNOWN';
      return overUnder(score.homeCorners + score.awayCorners, side, line);
    }
    if (subject === 'Match Cards') {
      if (score.homeCards == null || score.awayCards == null) return 'UNKNOWN';
      return overUnder(score.homeCards + score.awayCards, side, line);
    }
  }
  return 'UNKNOWN';
}
