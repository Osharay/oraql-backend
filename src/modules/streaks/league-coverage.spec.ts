import { coverageFrom, coverageGroupOf, isHidden } from './league-coverage';

const row = (leagueId: string, group: 'MAIN' | 'CORNERS' | 'CARDS', finished: number, settled: number) => ({
  leagueId,
  league: leagueId,
  country: null,
  group,
  finished,
  settled,
});

describe('league coverage', () => {
  it('hides a league whose matches mostly cannot be settled', () => {
    const c = coverageFrom([row('egypt-2', 'MAIN', 25, 3), row('serie-b', 'MAIN', 40, 39)], 0.8);
    expect(isHidden(c, 'egypt-2', 'TEAM_UNDER_1_5')).toBe(true);
    expect(isHidden(c, 'serie-b', 'TEAM_UNDER_1_5')).toBe(false);
  });

  it('hides only corner markets where corners do not arrive', () => {
    const c = coverageFrom([row('npfl', 'MAIN', 20, 19), row('npfl', 'CORNERS', 20, 2)], 0.8);
    expect(coverageGroupOf('MATCH_CORNERS_OVER_8_5')).toBe('CORNERS');
    expect(isHidden(c, 'npfl', 'MATCH_CORNERS_OVER_8_5')).toBe(true);
    expect(isHidden(c, 'npfl', 'BTTS_YES')).toBe(false);
  });

  it('does not judge a league on a handful of matches', () => {
    const c = coverageFrom([row('new', 'MAIN', 3, 0)], 0.8);
    expect(isHidden(c, 'new', 'BTTS_YES')).toBe(false);
  });

  it('lists hidden leagues first, worst first', () => {
    const c = coverageFrom([row('a', 'MAIN', 20, 19), row('b', 'MAIN', 20, 2), row('c', 'MAIN', 20, 10)], 0.8);
    expect(c.rows.map((r) => r.leagueId)).toEqual(['b', 'c', 'a']);
  });
});
