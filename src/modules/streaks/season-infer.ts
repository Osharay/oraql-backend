/**
 * Which season a match belongs to, for matches saved before the provider's
 * season was stored per match.
 *
 * Leagues run on different calendars: August to May in most of Europe,
 * February to December in Brazil, March to November in Scandinavia. Rather
 * than keep a list, each league's own fixtures say where its break is: its
 * quietest month. The season starts the month after, and is
 * named by the year it starts in — the provider's convention (2025 = 2025/26).
 */

/** Months are 1–12. counts[0] is January. */
export function seasonStartMonth(counts: number[], fallback = 7): number {
  const total = counts.reduce((n, c) => n + c, 0);
  if (counts.length !== 12 || total < 50) return fallback;
  // The quietest single month is the break; ties go to the one followed by
  // the quieter month (the break usually spans into it).
  let best = 0;
  for (let m = 1; m < 12; m++) {
    const quieter = counts[m] < counts[best];
    const tie = counts[m] === counts[best] && counts[(m + 1) % 12] < counts[(best + 1) % 12];
    if (quieter || tie) best = m;
  }
  // best is 0-based; the season starts the month after it.
  return ((best + 1) % 12) + 1;
}

export function seasonFor(kickoff: Date, startMonth: number): number {
  const month = kickoff.getUTCMonth() + 1;
  const year = kickoff.getUTCFullYear();
  return month >= startMonth ? year : year - 1;
}
