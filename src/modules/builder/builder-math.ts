/**
 * Pure helpers for the Bet Builder: which selections contradict each other,
 * and what can honestly be said about the chance that all of them land.
 */

export interface LegMarket {
  id: string;
  eventId: string;
  category: string;
  name: string;
  shortName?: string | null;
  probability: number;
}

type ParsedLeg =
  | { kind: 'result'; outcome: string }
  | { kind: 'btts'; yes: boolean }
  | { kind: 'total'; subject: string; side: 'Over' | 'Under'; line: number }
  | { kind: 'other' };

const TOTAL = /^(.+):\s+(Over|Under)\s+(\d+(?:\.\d+)?)$/;

export function parseLeg(m: Pick<LegMarket, 'category' | 'name' | 'shortName'>): ParsedLeg {
  if (m.category === 'MATCH_RESULT') {
    return { kind: 'result', outcome: m.shortName || m.name };
  }
  if (/^Both Teams to Score/i.test(m.name)) {
    return { kind: 'btts', yes: /Yes\s*$/i.test(m.name) };
  }
  const total = TOTAL.exec(m.name.trim());
  if (total) {
    return {
      kind: 'total',
      // "Match Goals", "Arsenal Goals", "Match Corners" — the quantity being counted.
      subject: total[1].trim().toLowerCase(),
      side: total[2] as 'Over' | 'Under',
      line: Number(total[3]),
    };
  }
  return { kind: 'other' };
}

/**
 * Why two selections from the SAME match cannot both land, or null if they can.
 *
 * Checked in both directions, so the order the user adds them in does not
 * matter. Over a and Under b on the same count are only compatible when there
 * is a whole number strictly between them (Over 1.5 + Under 3.5 = 2 or 3).
 */
export function conflictBetween(
  a: Pick<LegMarket, 'category' | 'name' | 'shortName'>,
  b: Pick<LegMarket, 'category' | 'name' | 'shortName'>,
): string | null {
  const pa = parseLeg(a);
  const pb = parseLeg(b);

  if (pa.kind === 'result' && pb.kind === 'result' && pa.outcome !== pb.outcome) {
    return 'a match can only have one result';
  }
  if (pa.kind === 'btts' && pb.kind === 'btts' && pa.yes !== pb.yes) {
    return 'both teams either score or they do not';
  }
  if (pa.kind === 'total' && pb.kind === 'total' && pa.subject === pb.subject && pa.side !== pb.side) {
    const over = pa.side === 'Over' ? pa : pb;
    const under = pa.side === 'Under' ? pa : pb;
    if (under.line <= over.line) {
      return `the count cannot be over ${over.line} and under ${under.line} at once`;
    }
  }
  return null;
}

export interface CombinedChance {
  /**
   * The single figure, when it can be given: every selection is from a
   * different match, which are treated as independent. Null when two or more
   * selections share a match — their joint chance is not the product.
   */
  probability: number | null;
  /** Always present. Equal to `probability` when there are no shared matches. */
  low: number;
  high: number;
  /** Matches holding more than one selection. */
  sharedMatches: number;
}

/**
 * The chance that every selection lands.
 *
 * Across different matches the legs are close enough to independent that the
 * product is a fair estimate. Within one match they are not: Over 2.5 goals
 * and Both Teams to Score rise and fall together, Over 2.5 implies Over 1.5.
 * Without a joint model of the match there is no single right number, so for
 * those legs we give the range every joint probability must fall in (the
 * Fréchet bounds): at most the least likely leg, at least what is left when
 * the others' misses are subtracted.
 */
export function combinedChance(legs: Array<Pick<LegMarket, 'eventId' | 'probability'>>): CombinedChance {
  if (legs.length === 0) return { probability: 1, low: 1, high: 1, sharedMatches: 0 };

  const byEvent = new Map<string, number[]>();
  for (const leg of legs) {
    const list = byEvent.get(leg.eventId) ?? [];
    list.push(clamp(leg.probability));
    byEvent.set(leg.eventId, list);
  }

  let low = 1;
  let high = 1;
  let sharedMatches = 0;

  for (const ps of byEvent.values()) {
    if (ps.length === 1) {
      low *= ps[0];
      high *= ps[0];
      continue;
    }
    sharedMatches++;
    high *= Math.min(...ps);
    low *= Math.max(0, ps.reduce((s, p) => s + p, 0) - (ps.length - 1));
  }

  const round = (x: number) => Math.round(x * 10000) / 10000;
  return {
    probability: sharedMatches === 0 ? round(high) : null,
    low: round(low),
    high: round(high),
    sharedMatches,
  };
}

const clamp = (p: number) => Math.min(1, Math.max(0, Number.isFinite(p) ? p : 0));
