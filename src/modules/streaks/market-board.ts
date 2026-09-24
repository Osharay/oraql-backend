/**
 * The fixture market board: every market in the registry, estimated for one
 * upcoming fixture from what both teams have actually done.
 *
 * The gated streak engine answers a narrow question — is this run more than
 * luck — and on most days the answer is no, which leaves the reader with an
 * empty page. The board answers the wider question the client keeps asking:
 * for THIS match, what does each of the 70 markets look like, and how much
 * evidence is behind it. Nothing here is a claim that a market is mispriced;
 * it is the record, stated per market, with its own weakness attached.
 *
 * Pure so the estimates can be pinned by tests without a database.
 */

export type Confidence = 'high' | 'medium' | 'low' | 'none';
export type BoardSort = 'probability' | 'edge' | 'confidence' | 'run';

/** Evidence for one side of one market. */
export interface SideEvidence {
  /** Who this is measured on, for the reader. */
  label: string;
  wins: number;
  played: number;
}

/**
 * Shrink a rate towards the market's usual rate.
 *
 * 5 from 5 is not a 100% market. With k pseudo-matches at the baseline rate,
 * a short record is pulled most of the way back to normal and a long one is
 * barely touched: 5/5 on a 50% market reads 67% at k=10, while 60/80 reads
 * 72%. This is what stops a thin sample from topping the board.
 *
 * Without a baseline, Laplace smoothing towards a half is the honest fallback.
 */
export function shrunkRate(wins: number, played: number, baseline: number | null, k = 10): number {
  const prior = baseline ?? 0.5;
  if (played <= 0) return prior;
  return (wins + k * prior) / (played + k);
}

/**
 * Both sides of a match-wide market, weighted by how much each has played.
 *
 * Over 2.5 goals in this fixture is informed by the home team's home matches
 * and the away team's away matches. Neither is the fixture, so they are
 * averaged rather than multiplied, and a side with twice the record counts
 * twice as much.
 */
export function combineSides(sides: SideEvidence[], baseline: number | null, k = 10): {
  probability: number;
  wins: number;
  played: number;
} {
  const played = sides.reduce((n, s) => n + s.played, 0);
  const wins = sides.reduce((n, s) => n + s.wins, 0);
  return { probability: shrunkRate(wins, played, baseline, k), wins, played };
}

/**
 * How much to trust a row, in words, from the matches behind it.
 *
 * The bands are deliberately blunt. The client asked to see every market for
 * every fixture, including the ones with almost nothing behind them — so the
 * board shows them and says so, rather than hiding them and implying the rest
 * are all equally solid.
 */
/**
 * Matches a row needs before it is shown or ranked at all.
 *
 * Andorra v Malta reported "98 of 103 markets have settled history" when
 * every row rested on one or two matches — and, because a rate that thin is
 * pulled almost entirely back to the market's own average, both teams showed
 * the same number down the page. That is not a measurement; it is the
 * baseline wearing a fixture's name.
 */
export const EVIDENCE_FLOOR = 10;

export const meetsFloor = (played: number): boolean => played >= EVIDENCE_FLOOR;

export function confidenceOf(played: number): Confidence {
  if (played <= 0) return 'none';
  if (played < 10) return 'low';
  if (played < 25) return 'medium';
  return 'high';
}

export const CONFIDENCE_NOTE: Record<Confidence, string> = {
  none: 'No settled matches on record for this market yet.',
  low: 'Thin evidence — fewer than 10 settled matches behind it.',
  medium: 'Moderate evidence — 10 to 24 settled matches.',
  high: '25 or more settled matches behind it.',
};

export interface BoardRow {
  probability: number;
  baselineRate: number | null;
  /** Probability less the market's usual rate. What this fixture adds. */
  edge: number | null;
  played: number;
  confidence: Confidence;
  currentRun: number;
}

/** Rank the board. Probability first by default, since that is what is asked. */
export function compareBoard(sort: BoardSort = 'probability') {
  const rank: Record<Confidence, number> = { high: 3, medium: 2, low: 1, none: 0 };

  return (a: BoardRow, b: BoardRow): number => {
    // Evidence band first, before any sort: a 12-match row at 68% outranks a
    // 2-match row at 85% whichever sort is chosen, because the second is not
    // a measurement of anything.
    const aFloor = meetsFloor(a.played);
    const bFloor = meetsFloor(b.played);
    if (aFloor !== bFloor) return aFloor ? -1 : 1;

    if (sort === 'edge') {
      const ae = a.edge ?? -1;
      const be = b.edge ?? -1;
      if (be !== ae) return be - ae;
    }
    if (sort === 'run' && b.currentRun !== a.currentRun) {
      return b.currentRun - a.currentRun;
    }
    if (sort === 'confidence' && rank[b.confidence] !== rank[a.confidence]) {
      return rank[b.confidence] - rank[a.confidence];
    }

    if ((a.confidence === 'none') !== (b.confidence === 'none')) {
      return a.confidence === 'none' ? 1 : -1;
    }

    if (b.probability !== a.probability) return b.probability - a.probability;
    return b.played - a.played;
  };
}
