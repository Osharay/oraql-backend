/**
 * The fixture a streak card is about, and whether it is a league or a cup
 * match. A streak on its own ("Northampton — under 1.5 goals") leaves the
 * reader to find out who they play, where, when and in what; the card should
 * say it.
 */

export type CompetitionKind = 'LEAGUE' | 'CUP';

// Knockout and continental competitions. The provider files cups as leagues,
// so the name and the round are all there is to go on.
const CUP_WORDS =
  /\b(cup|copa|coupe|coppa|pokal|beker|ta[çc]a|trophy|shield|super ?cup|supercopa|champions league|europa|conference league|libertadores|sudamericana|concacaf|afc|caf|playoffs?|play-offs?|qualification|friendl)/i;

/**
 * "Regular Season - 15" is the provider's round name for league matches; a
 * cup name wins otherwise, and anything unrecognised is taken as a league.
 */
export function competitionKind(leagueName: string, round?: string | null): CompetitionKind {
  if (round && /^regular season/i.test(round)) return 'LEAGUE';
  if (CUP_WORDS.test(leagueName)) return 'CUP';
  if (round && /(final|round of|knockout|qualif|play-?off|preliminary)/i.test(round)) return 'CUP';
  return 'LEAGUE';
}

export interface NextFixture {
  eventId: string;
  kickoffAt: Date;
  home: { id: string; name: string };
  away: { id: string; name: string };
  isHome: boolean;
  competition: { name: string; country: string | null; kind: CompetitionKind; round: string | null };
}

/** Each team's first fixture from a list already ordered by kickoff. */
export function firstFixtureByTeam(
  teamIds: string[],
  events: Array<{
    id: string;
    kickoffAt: Date;
    round: string | null;
    homeTeam: { id: string; name: string };
    awayTeam: { id: string; name: string };
    league: { name: string; country: string | null };
  }>,
): Map<string, NextFixture> {
  const wanted = new Set(teamIds);
  const out = new Map<string, NextFixture>();
  for (const e of events) {
    for (const [teamId, isHome] of [
      [e.homeTeam.id, true],
      [e.awayTeam.id, false],
    ] as const) {
      if (!wanted.has(teamId) || out.has(teamId)) continue;
      out.set(teamId, {
        eventId: e.id,
        kickoffAt: e.kickoffAt,
        home: e.homeTeam,
        away: e.awayTeam,
        isHome,
        competition: {
          name: e.league.name,
          country: e.league.country,
          kind: competitionKind(e.league.name, e.round),
          round: e.round,
        },
      });
    }
  }
  return out;
}
