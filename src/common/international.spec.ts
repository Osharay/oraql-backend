import { isInternationalCompetition } from './international';

describe('isInternationalCompetition', () => {
  it('knows national-team football', () => {
    for (const n of ['World Cup - Qualification Europe', 'UEFA Nations League', 'Friendlies', 'Africa Cup of Nations - Qualification', 'Copa America'])
      expect(isInternationalCompetition(n, 'World')).toBe(true);
  });

  it('keeps club competitions as club, even under "World"', () => {
    for (const n of ['UEFA Champions League', 'CONMEBOL Libertadores', 'Friendlies Clubs', 'Club Friendlies', 'AFC Champions League'])
      expect(isInternationalCompetition(n, 'World')).toBe(false);
    expect(isInternationalCompetition('Premier League', 'England')).toBe(false);
    expect(isInternationalCompetition('FA Cup', 'England')).toBe(false);
  });
});
