/**
 * Plain-English descriptions of markets, for text the user reads or sends on.
 *
 * A market name alone ("Over 0.5 Goals") names an outcome but not its
 * subject, and readers take the missing subject to be one of the two clubs
 * on the card. Anything the API renders as prose — the builder export above
 * all, which gets pasted into WhatsApp — states the subject explicitly.
 *
 * Names are stored in one shape, "<subject> <metric>: <Over|Under> <line>",
 * where the subject is either "Match" or a club. The parser also reads the
 * names written before the rename ("Over 2.5 Goals"), because those rows are
 * still in the database.
 *
 * The frontend has a fuller counterpart at oracle-web/src/lib/market-copy.ts.
 */

export interface TeamLike {
  name: string;
  shortName?: string | null;
}

const team = (t: TeamLike) => t.shortName || t.name;

interface Parsed {
  kind: 'matchTotal' | 'teamTotal' | 'result' | 'btts' | 'unknown';
  subject?: string;
  metric?: string;
  direction?: 'over' | 'under';
  line?: number;
  team?: string;
  outcome?: 'draw' | 'yes' | 'no';
}

function parse(name: string): Parsed {
  const n = name.trim();

  // "Match Goals: Over 2.5" / "Arsenal Goals: Over 0.5"
  const totals = /^(.+?)\s+(Goals|Corners|Cards)\s*:\s*(Over|Under)\s+([\d.]+)$/i.exec(n);
  if (totals) {
    const subject = totals[1].trim();
    const isMatch = /^match$/i.test(subject);
    return {
      kind: isMatch ? 'matchTotal' : 'teamTotal',
      subject: isMatch ? undefined : subject,
      metric: totals[2].toLowerCase(),
      direction: totals[3].toLowerCase() as 'over' | 'under',
      line: Number(totals[4]),
    };
  }

  // Legacy match totals: "Over 2.5 Goals"
  const legacy = /^(Over|Under)\s+([\d.]+)\s+(Goals|Corners|Cards)/i.exec(n);
  if (legacy) {
    return {
      kind: 'matchTotal',
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

/** "goals" -> "scores", for a team subject. */
function teamTotalPhrase(subject: string, metric: string, direction: string, line: number): string {
  const goals = metric === 'goals';

  if (direction === 'over') {
    const atLeast = Math.ceil(line);
    if (goals) {
      return atLeast === 1
        ? `${subject} scores at least once`
        : `${subject} scores ${atLeast} or more`;
    }
    return `${subject} takes ${atLeast} or more ${metric}`;
  }

  const atMost = Math.floor(line);
  if (goals) {
    if (atMost === 0) return `${subject} fails to score`;
    if (atMost === 1) return `${subject} scores at most once`;
    return `${subject} scores ${atMost} or fewer`;
  }
  return `${subject} takes ${atMost} or fewer ${metric}`;
}

/**
 * One line naming both the outcome and who it is about.
 * e.g. "More than 2.5 goals in the match (both teams combined)",
 *      "Arsenal scores at least once (full match)".
 */
export function describeMarket(
  marketName: string,
  fixture?: { homeTeam: TeamLike; awayTeam: TeamLike },
): string {
  const p = parse(marketName);

  if (p.kind === 'teamTotal' && p.subject && p.metric && p.direction && p.line !== undefined) {
    return `${teamTotalPhrase(p.subject, p.metric, p.direction, p.line)} (full match)`;
  }

  if (p.kind === 'matchTotal' && p.metric && p.direction && p.line !== undefined) {
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

// ─── Streak markets ───
//
// The streak registry names markets generically — "Team To Win", "Draw No
// Bet", "Team Under 1.5 Goals" — because one definition is evaluated for
// whichever side it is measured on. Displayed as-is against a fixture, that
// reads as though it covers both clubs, and a client asked which team the
// draw-no-bet belonged to. Only one can be selected for it.
//
// A candidate's `selection` cannot answer that: it is null for venue-agnostic
// slices, which is most of them. The market's scope and the candidate's
// entity answer it instead.

export type MarketScopeName = 'TEAM' | 'MATCH';

export interface MarketSubject {
  scope: MarketScopeName;
  /** The club, when the market is about one. */
  team: string | null;
  /** One line stating who the figure covers. */
  label: string;
}

/**
 * The market named for the club it applies to.
 * "Team To Win" + Marseille -> "Marseille To Win"
 * "Draw No Bet" + Marseille -> "Marseille — Draw No Bet"
 */
export function streakMarketLabel(
  displayName: string,
  scope: MarketScopeName,
  teamName?: string | null,
): string {
  if (scope !== 'TEAM' || !teamName) return displayName;

  // Most team markets are written with a literal "Team" placeholder.
  if (/^team\b/i.test(displayName)) {
    return displayName.replace(/^team\b/i, teamName);
  }
  if (/\bteam\b/i.test(displayName)) {
    return displayName.replace(/\bteam\b/i, teamName);
  }
  // The rest name an outcome with no placeholder, so say whose it is.
  return `${teamName} — ${displayName}`;
}

/**
 * Who the figure covers, stated rather than implied.
 */
export function marketSubjectOf(
  scope: MarketScopeName,
  teamName?: string | null,
): MarketSubject {
  if (scope === 'TEAM' && teamName) {
    return { scope, team: teamName, label: `${teamName} only — not the match total` };
  }
  if (scope === 'TEAM') {
    return { scope, team: null, label: 'One team only — not the match total' };
  }
  return { scope: 'MATCH', team: null, label: 'Both teams combined — match total' };
}
