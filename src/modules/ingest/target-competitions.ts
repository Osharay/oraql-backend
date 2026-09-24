/**
 * The competitions OraQL covers on purpose.
 *
 * Coverage used to follow whatever fixtures arrived, which filled the
 * database with U19 leagues, friendlies and Romania's Liga III while the
 * Botola Pro and Ligue 2 held nothing. This is the list instead: what
 * mainstream books actually price, checked against Oddschecker's league and
 * cup index and against what Nigerian platforms put on their front pages.
 *
 * Names and countries only — API-Football ids are resolved from the
 * provider's own league list at seed time and stored on the row, because a
 * guessed id quietly poisons a whole season of data.
 *
 * Tier 1 gets six seasons, tier 2 four, cups and international four. Seasons
 * here are fixtures held; how many are DERIVED into observations is a
 * separate dial, since observations are what fill the disk.
 */

export interface TargetSeed {
  name: string;
  country: string;
  tier: 1 | 2 | 3;
  seasons: number;
  /** Alternative names the provider might use. */
  aliases?: string[];
}

const T1 = (name: string, country: string, aliases?: string[]): TargetSeed => ({
  name,
  country,
  tier: 1,
  seasons: 6,
  aliases,
});

const T2 = (name: string, country: string, aliases?: string[]): TargetSeed => ({
  name,
  country,
  tier: 2,
  seasons: 4,
  aliases,
});

const CUP = (name: string, country: string, aliases?: string[]): TargetSeed => ({
  name,
  country,
  tier: 3,
  seasons: 4,
  aliases,
});

export const TARGET_COMPETITIONS: TargetSeed[] = [
  // ── Tier 1: the leagues every book leads with ──────────────────────────
  T1('Premier League', 'England'),
  T1('Championship', 'England'),
  T1('La Liga', 'Spain', ['Primera Division', 'LaLiga']),
  T1('Serie A', 'Italy'),
  T1('Bundesliga', 'Germany'),
  T1('Ligue 1', 'France'),
  T1('Eredivisie', 'Netherlands'),
  T1('Primeira Liga', 'Portugal', ['Liga Portugal']),
  T1('Jupiler Pro League', 'Belgium', ['Pro League', 'First Division A']),
  T1('Süper Lig', 'Turkey', ['Super Lig']),
  T1('Premiership', 'Scotland', ['Scottish Premiership']),
  T1('UEFA Champions League', 'World', ['Champions League']),
  T1('UEFA Europa League', 'World', ['Europa League']),
  T1('UEFA Europa Conference League', 'World', ['Conference League']),
  T1('Serie A', 'Brazil', ['Brasileirão', 'Campeonato Brasileiro Série A']),
  T1('Liga Profesional Argentina', 'Argentina', ['Primera División', 'Torneo Betano']),
  T1('Major League Soccer', 'USA', ['MLS']),
  T1('Liga MX', 'Mexico', ['Liga BBVA MX']),
  T1('Pro League', 'Saudi-Arabia', ['Saudi Pro League', 'Saudi League']),

  // ── Tier 2: priced everywhere, just less of the turnover ───────────────
  T2('League One', 'England'),
  T2('League Two', 'England'),
  T2('Segunda División', 'Spain', ['La Liga 2', 'LaLiga2']),
  T2('Serie B', 'Italy'),
  T2('2. Bundesliga', 'Germany'),
  T2('Ligue 2', 'France'),
  T2('Eerste Divisie', 'Netherlands'),
  T2('Liga Portugal 2', 'Portugal', ['Segunda Liga', 'Liga Portugal SABSEG']),
  T2('Super League 1', 'Greece', ['Super League']),
  T2('Bundesliga', 'Austria', ['Austrian Bundesliga', 'Admiral Bundesliga']),
  T2('Super League', 'Switzerland', ['Swiss Super League']),
  T2('Superliga', 'Denmark', ['Danish Superliga', '3F Superliga']),
  T2('Allsvenskan', 'Sweden'),
  T2('Eliteserien', 'Norway'),
  T2('Ekstraklasa', 'Poland'),
  T2('Czech Liga', 'Czech-Republic', ['First League', 'Fortuna Liga']),
  T2('HNL', 'Croatia', ['1. HNL', 'SuperSport HNL']),
  T2('Super Liga', 'Serbia', ['SuperLiga', 'Mozzart Bet Superliga']),
  T2('Liga I', 'Romania', ['SuperLiga']),
  T2('Premier League', 'Ukraine', ['Ukrainian Premier League']),
  T2('Premier League', 'Egypt', ['Egyptian Premier League']),
  T2('Botola Pro', 'Morocco'),
  T2('Premier Soccer League', 'South-Africa', ['Betway Premiership', 'PSL']),
  T2('NPFL', 'Nigeria', ['Nigeria Professional Football League', 'Premier League']),
  T2('J1 League', 'Japan', ['J. League']),
  T2('K League 1', 'South-Korea'),
  T2('A-League', 'Australia', ['A-League Men']),
  T2('Serie B', 'Brazil', ['Campeonato Brasileiro Série B']),
  T2('Primera A', 'Colombia', ['Liga BetPlay']),

  // ── Cups and continental: fewer matches, heavy betting interest ────────
  CUP('FA Cup', 'England'),
  CUP('League Cup', 'England', ['EFL Cup', 'Carabao Cup']),
  CUP('Copa del Rey', 'Spain'),
  CUP('Coppa Italia', 'Italy'),
  CUP('DFB Pokal', 'Germany', ['DFB-Pokal']),
  CUP('Coupe de France', 'France'),
  CUP('Copa Do Brasil', 'Brazil', ['Copa do Brasil']),
  CUP('CONMEBOL Libertadores', 'World', ['Copa Libertadores']),
  CUP('CONMEBOL Sudamericana', 'World', ['Copa Sudamericana']),
  CUP('CAF Champions League', 'World'),
  CUP('AFC Champions League', 'World', ['AFC Champions League Elite']),

  // ── International: what keeps the card alive during club breaks ────────
  CUP('World Cup', 'World'),
  CUP('World Cup - Qualification Europe', 'World', ['WC Qualification Europe']),
  CUP('World Cup - Qualification Africa', 'World', ['WC Qualification Africa']),
  CUP('Euro Championship', 'World', ['UEFA Euro']),
  CUP('UEFA Nations League', 'World', ['Nations League']),
  CUP('Africa Cup of Nations', 'World', ['AFCON']),
  CUP('Copa America', 'World'),
];

/** Loose match: same competition, however the provider spells it. */
export function matchesSeed(
  seed: TargetSeed,
  league: { name: string; country?: string | null },
): boolean {
  const normalise = (v: string) =>
    v
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]/g, '');

  const names = [seed.name, ...(seed.aliases ?? [])].map(normalise);
  if (!names.includes(normalise(league.name))) return false;

  // "Premier League" exists in England, Ukraine, Egypt, Nigeria and Bhutan.
  // The country is what tells them apart, so it is never optional.
  if (seed.country === 'World') return true;
  return normalise(league.country ?? '') === normalise(seed.country);
}
