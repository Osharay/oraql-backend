import { detectLeagueChange, LeagueRow } from './league-change';

/** n matches in a league and season, several rows (markets) each. */
const games = (league: string, season: number, n: number, from = 0): LeagueRow[] =>
  Array.from({ length: n }, (_, i) =>
    Array.from({ length: 3 }, () => ({ eventId: `${league}-${season}-${from + i}`, leagueId: league, season })),
  ).flat();

describe('detectLeagueChange', () => {
  it('spots a relegation: Championship last season, League One now', () => {
    const rows = [...games('CHAMP', 2025, 46), ...games('L1', 2026, 7), ...games('LCUP', 2026, 2)];
    expect(detectLeagueChange(rows)).toEqual({ season: 2026, fromLeagueId: 'CHAMP', toLeagueId: 'L1' });
  });

  it('sees no change when the team stayed up', () => {
    const rows = [...games('L1', 2025, 46), ...games('L1', 2026, 7, 100), ...games('LCUP', 2026, 2)];
    expect(detectLeagueChange(rows)).toBeNull();
  });

  it('does not let early cup ties pass for a new league', () => {
    const rows = [...games('L1', 2025, 46), ...games('LCUP', 2026, 2)];
    expect(detectLeagueChange(rows)).toBeNull();
  });

  it('needs a few matches in the new league before believing it', () => {
    const rows = [...games('CHAMP', 2025, 46), ...games('L1', 2026, 2)];
    expect(detectLeagueChange(rows)).toBeNull();
  });

  it('needs two seasons to compare', () => {
    expect(detectLeagueChange(games('L1', 2026, 10))).toBeNull();
    expect(detectLeagueChange([])).toBeNull();
  });
});
