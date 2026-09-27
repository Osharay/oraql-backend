import { competitionKind, firstFixtureByTeam } from './next-fixture';

describe('competitionKind', () => {
  it('reads league rounds as league', () => {
    expect(competitionKind('League Two', 'Regular Season - 8')).toBe('LEAGUE');
    expect(competitionKind('Premier League', null)).toBe('LEAGUE');
  });

  it('reads cups by name or round', () => {
    expect(competitionKind('EFL Trophy', 'Group Stage - 2')).toBe('CUP');
    expect(competitionKind('FA Cup', '1st Round')).toBe('CUP');
    expect(competitionKind('Copa de la División Profesional', 'Group Stage - 5')).toBe('CUP');
    expect(competitionKind('UEFA Champions League', 'League Stage - 3')).toBe('CUP');
    expect(competitionKind('Second League', 'Promotion Play-offs')).toBe('CUP');
  });
});

describe('firstFixtureByTeam', () => {
  const league = { name: 'League Two', country: 'England' };
  const york = { id: 'york', name: 'York City' };
  const nor = { id: 'nor', name: 'Northampton' };
  const other = { id: 'x', name: 'Other' };

  it('takes each team\'s earliest fixture and says which side it is', () => {
    const events = [
      { id: 'e1', kickoffAt: new Date('2026-10-10T14:00:00Z'), round: 'Regular Season - 9', homeTeam: york, awayTeam: nor, league },
      { id: 'e2', kickoffAt: new Date('2026-10-14T14:00:00Z'), round: 'Regular Season - 10', homeTeam: nor, awayTeam: other, league },
    ];
    const map = firstFixtureByTeam(['nor'], events);
    expect(map.get('nor')).toMatchObject({
      eventId: 'e1',
      isHome: false,
      home: york,
      away: nor,
      competition: { name: 'League Two', country: 'England', kind: 'LEAGUE' },
    });
    expect(map.has('york')).toBe(false);
    expect(map.get('nor')!.strength).toBeNull();
  });

  it('says who is stronger once both sides are rated', () => {
    const events = [
      {
        id: 'e1',
        kickoffAt: new Date('2026-10-10T14:00:00Z'),
        round: 'Regular Season - 9',
        homeTeam: { ...york, rating: 1580, ratingTier: 'STRONG' },
        awayTeam: { ...nor, rating: 1420, ratingTier: 'WEAK' },
        league,
      },
    ];
    expect(firstFixtureByTeam(['nor'], events).get('nor')!.strength).toEqual({
      home: { rating: 1580, tier: 'STRONG' },
      away: { rating: 1420, tier: 'WEAK' },
      stronger: 'HOME',
    });
  });
});
