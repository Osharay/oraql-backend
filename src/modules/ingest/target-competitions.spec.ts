import { TARGET_COMPETITIONS, matchesSeed, type TargetSeed } from './target-competitions';

describe('target competitions', () => {
  it('covers enough ground to be a product', () => {
    expect(TARGET_COMPETITIONS.length).toBeGreaterThanOrEqual(50);
  });

  it('gives tier 1 the deepest history', () => {
    for (const c of TARGET_COMPETITIONS) {
      if (c.tier === 1) expect(c.seasons).toBe(6);
      else expect(c.seasons).toBeGreaterThanOrEqual(4);
    }
  });

  it('holds no youth or friendly competition', () => {
    for (const c of TARGET_COMPETITIONS) {
      expect(c.name).not.toMatch(/\bu-?\d\d\b|youth|friendl/i);
    }
  });

  it('names a country for every domestic competition', () => {
    for (const c of TARGET_COMPETITIONS) {
      expect(c.country.length).toBeGreaterThan(0);
    }
  });
});

describe('matchesSeed', () => {
  const seed = (over: Partial<TargetSeed>): TargetSeed => ({
    name: 'Premier League',
    country: 'England',
    tier: 1,
    seasons: 6,
    ...over,
  });

  it('matches the provider spelling of the same competition', () => {
    expect(matchesSeed(seed({}), { name: 'Premier League', country: 'England' })).toBe(true);
  });

  // The whole reason ids are resolved rather than guessed: five countries run
  // a "Premier League", and Bhutan's was on the fixture list this week.
  it('does not confuse two competitions sharing a name', () => {
    expect(matchesSeed(seed({}), { name: 'Premier League', country: 'Bhutan' })).toBe(false);
    expect(matchesSeed(seed({}), { name: 'Premier League', country: 'Ukraine' })).toBe(false);
  });

  it('accepts an alias', () => {
    const laliga = seed({ name: 'La Liga', country: 'Spain', aliases: ['Primera Division'] });
    expect(matchesSeed(laliga, { name: 'Primera Division', country: 'Spain' })).toBe(true);
  });

  it('ignores accents, case and punctuation', () => {
    const turkey = seed({ name: 'Süper Lig', country: 'Turkey' });
    expect(matchesSeed(turkey, { name: 'Super Lig', country: 'turkey' })).toBe(true);
    const pokal = seed({ name: 'DFB Pokal', country: 'Germany', aliases: ['DFB-Pokal'] });
    expect(matchesSeed(pokal, { name: 'DFB-Pokal', country: 'Germany' })).toBe(true);
  });

  it('lets a World competition match whatever country the provider files it under', () => {
    const ucl = seed({ name: 'UEFA Champions League', country: 'World' });
    expect(matchesSeed(ucl, { name: 'UEFA Champions League', country: null })).toBe(true);
  });

  it('refuses a different competition in the right country', () => {
    expect(matchesSeed(seed({}), { name: 'Championship', country: 'England' })).toBe(false);
  });

  it('covers the Egyptian second tier under the names the provider may use', () => {
    const seed = TARGET_COMPETITIONS.find((c) => c.country === 'Egypt' && c.name === 'Second League')!;
    expect(seed).toBeDefined();
    for (const name of ['Second League', 'Division 2', 'Second Division A']) {
      expect(matchesSeed(seed, { name, country: 'Egypt' })).toBe(true);
    }
    // Never another country's second tier.
    expect(matchesSeed(seed, { name: 'Second League', country: 'Bulgaria' })).toBe(false);
    // And the top flight still resolves to its own seed, not this one.
    expect(matchesSeed(seed, { name: 'Premier League', country: 'Egypt' })).toBe(false);
  });
});
