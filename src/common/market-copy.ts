/**
 * Plain-English descriptions of markets, for text the user reads or sends on.
 *
 * A market name alone ("Over 0.5 Goals") names an outcome but not its
 * subject, and readers take the missing subject to be one of the two clubs
 * on the card. Anything the API renders as prose — the builder export above
 * all, which gets pasted into WhatsApp — states the subject explicitly.
 *
 * The frontend has a fuller counterpart at oracle-web/src/lib/market-copy.ts;
 * both parse the current names ("Match Goals: Over 2.5") and the ones written
 * before the rename ("Over 2.5 Goals"), because both are in the database.
 */

export interface TeamLike {
  name: string;
  shortName?: string | null;
}

const team = (t: TeamLike) => t.shortName || t.name;

interface Parsed {
  kind: 'total' | 'result' | 'btts' | 'unknown';
  metric?: string;
  direction?: 'over' | 'under';
  line?: number;
  team?: string;
  outcome?: 'draw' | 'yes' | 'no';
}

function parse(name: string): Parsed {
  const n = name.trim();

  const current = /^Match\s+(Goals|Corners|Cards)\s*:\s*(Over|Under)\s+([\d.]+)/i.exec(n);
  if (current) {
    return {
      kind: 'total',
      metric: current[1].toLowerCase(),
      direction: current[2].toLowerCase() as 'over' | 'under',
      line: Number(current[3]),
    };
  }

  const legacy = /^(Over|Under)\s+([\d.]+)\s+(Goals|Corners|Cards)/i.exec(n);
  if (legacy) {
    return {
      kind: 'total',
      metric: legacy[3].toLowerCase(),
      direction: legacy[1].toLowerCase() as 'over' | 'under',
      line: Number(legacy[2]),
    };
  }

  if (/both\s+teams\s+to\s+score/i.test(n)) {
    return { kind: 'btts', outcome: /\b(no|not)\b/i.test(n) ? 'no' : 'yes' };
  }

  if (/^draw$/i.test(n) || /\bdraw\b/i.test(n)) {
    return { kind: 'result', outcome: 'draw' };
  }

  const toWin = /^(.+?)\s+to\s+win$/i.exec(n);
  if (toWin) return { kind: 'result', team: toWin[1].trim() };

  const legacyResult = /^(Home|Away)\s+Win$/i.exec(n);
  if (legacyResult) {
    return { kind: 'result', team: legacyResult[1].toLowerCase() === 'home' ? '__home' : '__away' };
  }

  return { kind: 'unknown' };
}

/**
 * One line naming both the outcome and who it is about.
 * e.g. "More than 2.5 goals in the match (both teams combined)".
 */
export function describeMarket(
  marketName: string,
  fixture?: { homeTeam: TeamLike; awayTeam: TeamLike },
): string {
  const p = parse(marketName);

  if (p.kind === 'total' && p.metric && p.direction && p.line !== undefined) {
    const word = p.direction === 'over' ? 'More than' : 'Fewer than';
    return `${word} ${p.line} ${p.metric} in the match (both teams combined)`;
  }

  if (p.kind === 'btts') {
    return p.outcome === 'no'
      ? 'At least one team fails to score (full match)'
      : 'Both teams score at least once (full match)';
  }

  if (p.kind === 'result') {
    if (p.outcome === 'draw') return 'The match ends level (90 minutes)';
    let name = p.team;
    if (name === '__home') name = fixture ? team(fixture.homeTeam) : 'The home team';
    if (name === '__away') name = fixture ? team(fixture.awayTeam) : 'The away team';
    if (name) return `${name} wins the match (90 minutes)`;
  }

  return marketName;
}
