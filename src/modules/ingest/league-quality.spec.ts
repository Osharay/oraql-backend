import {
  isExcludedCompetition,
  isLowTierCompetition,
  isWantedCompetition,
  compareCoverage,
  type CoverageTarget,
} from './league-quality';

/**
 * Taken from a real coverage preview: 100 league-seasons to backfill, and the
 * first forty were U19 leagues, a U20 championship, friendlies and six series
 * of Romania's third division. The budget would have gone on those before a
 * single league anyone bets.
 */
describe('isExcludedCompetition', () => {
  it.each([
    'U19 League',
    'COSAFA U20 Championship',
    'UEFA U17 Championship - Qualification',
    'Youth Championship',
    'Friendlies',
    'Friendlies Clubs',
    'Campeonato Primavera',
    'Premier League 2 Reserve',
  ])('keeps out %s', (name) => {
    expect(isExcludedCompetition(name)).toBe(true);
  });

  it.each([
    'Premier League',
    'La Liga',
    'Serie A',
    'UEFA Champions League',
    'Girabola',
    'Liga III - Serie 1',
    'FA Cup',
    'Eredivisie',
  ])('keeps %s', (name) => {
    expect(isExcludedCompetition(name)).toBe(false);
  });

  it('does not mistake a club name containing a letter-number for a youth side', () => {
    expect(isExcludedCompetition('Bundesliga 2')).toBe(false);
    expect(isExcludedCompetition('Ligue 2')).toBe(false);
  });
});

describe('isLowTierCompetition', () => {
  it('marks third tier and regional football as last in the queue', () => {
    expect(isLowTierCompetition('Liga III - Serie 4')).toBe(true);
    expect(isLowTierCompetition('Liga Alef')).toBe(true);
    expect(isLowTierCompetition('Oberliga Hamburg')).toBe(true);
    expect(isLowTierCompetition('Premier League')).toBe(false);
  });
});

describe('compareCoverage', () => {
  const t = (name: string, upcoming: number): CoverageTarget => ({
    leagueExternalId: name,
    name,
    upcoming,
  });

  it('covers the busiest competition first', () => {
    const quiet = t('Cup', 1);
    const busy = t('Premier League', 10);
    expect([quiet, busy].sort(compareCoverage)[0]).toBe(busy);
  });

  it('puts a third-tier competition behind a top one even when it has more fixtures', () => {
    const third = t('Liga III - Serie 2', 20);
    const top = t('Eredivisie', 4);
    expect([third, top].sort(compareCoverage)[0]).toBe(top);
  });

  it('is stable on name when nothing else separates two competitions', () => {
    expect([t('B', 5), t('A', 5)].sort(compareCoverage)[0].name).toBe('A');
  });
});

describe('isWantedCompetition', () => {
  const env = process.env;
  beforeEach(() => {
    process.env = { ...env };
    delete process.env.COMPETITION_EXCLUDE;
  });
  afterAll(() => {
    process.env = env;
  });

  it('holds an ordinary league', () => {
    expect(isWantedCompetition('Serie A')).toBe(true);
  });

  it('honours a deployment’s own exclusions', () => {
    process.env.COMPETITION_EXCLUDE = 'Girabola, Liga III';
    expect(isWantedCompetition('Girabola')).toBe(false);
    expect(isWantedCompetition('Liga III - Serie 3')).toBe(false);
    expect(isWantedCompetition('Serie A')).toBe(true);
  });
});
