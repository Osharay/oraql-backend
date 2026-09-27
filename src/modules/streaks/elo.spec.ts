import {
  compareSides,
  expectedHome,
  finishedInUpperHalf,
  goalMultiplier,
  leagueTiers,
  replay,
  RatedMatch,
  START_RATING,
} from './elo';

let seq = 0;
const day = (n: number) => new Date(Date.UTC(2025, 0, 1) + n * 86_400_000);
const match = (
  d: number,
  home: string,
  away: string,
  hg: number,
  ag: number,
  leagueId = 'L1',
  isLeague = true,
): RatedMatch => ({
  id: `m${seq++}`,
  kickoffAt: day(d),
  leagueId,
  isLeague,
  homeTeamId: home,
  awayTeamId: away,
  homeGoals: hg,
  awayGoals: ag,
});

describe('elo basics', () => {
  it('gives the home side the edge between equals', () => {
    expect(expectedHome(1500, 1500)).toBeGreaterThan(0.5);
    expect(expectedHome(1500, 1500, 0)).toBeCloseTo(0.5);
  });

  it('counts bigger wins for more', () => {
    expect(goalMultiplier(1)).toBe(1);
    expect(goalMultiplier(-2)).toBe(1.5);
    expect(goalMultiplier(4)).toBeGreaterThan(1.5);
  });

  it('moves the winner up and the loser down by the same amount', () => {
    const { ratings, before } = replay([match(0, 'A', 'B', 2, 0)]);
    const a = ratings.get('A')!.rating;
    const b = ratings.get('B')!.rating;
    expect(a).toBeGreaterThan(START_RATING);
    expect(a - START_RATING).toBeCloseTo(START_RATING - b);
    expect([...before.values()][0]).toEqual([START_RATING, START_RATING]);
  });

  it('separates a side that keeps winning from one that keeps losing', () => {
    const games: RatedMatch[] = [];
    const teams = ['A', 'B', 'C', 'D', 'E', 'F'];
    let d = 0;
    for (let round = 0; round < 6; round++) {
      for (const t of teams.slice(1)) games.push(match(d++, 'A', t, 3, 0)); // A beats everyone
      for (const t of teams.slice(0, 5)) games.push(match(d++, t, 'F', 2, 0)); // F loses to everyone
    }
    const { ratings } = replay(games);
    const tiers = leagueTiers(ratings);
    expect(tiers.get('A')).toBe('STRONG');
    expect(tiers.get('F')).toBe('WEAK');
  });
});

/** A double round robin where `team` wins or loses every match; the rest draw. */
const season = (leagueId: string, teams: string[], team: string, how: 'win' | 'lose'): RatedMatch[] => {
  const out: RatedMatch[] = [];
  let d = 0;
  for (const h of teams)
    for (const a of teams) {
      if (h === a) continue;
      const involved = h === team || a === team;
      const teamWins = how === 'win';
      const [hg, ag] = !involved ? [1, 1] : (h === team) === teamWins ? [2, 0] : [0, 2];
      out.push(match(d++, h, a, hg, ag, leagueId));
    }
  return out;
};

describe('changing league', () => {
  // Six teams in L2 play a season so the league has an average.
  const lower = (): RatedMatch[] => {
    const out: RatedMatch[] = [];
    const t = ['p', 'q', 'r', 's', 't', 'u'];
    let d = 100;
    for (let i = 0; i < t.length; i++)
      for (let j = 0; j < t.length; j++) if (i !== j) out.push(match(d++, t[i], t[j], 1, 1, 'L2'));
    return out;
  };

  it('starts a relegated side above its new league\'s average', () => {
    const games: RatedMatch[] = [];
    // R finishes bottom of a six-team L1: beaten by everyone, home and away.
    games.push(...season('L1', ['A', 'B', 'C', 'D', 'E', 'R'], 'R', 'lose'));
    games.push(...lower());
    games.push(match(200, 'R', 'p', 1, 1, 'L2'));
    const { before } = replay(games);
    const [r, p] = before.get(games[games.length - 1].id)!;
    expect(r).toBeGreaterThan(p);
  });

  it('starts a promoted side below its new league\'s average', () => {
    const games: RatedMatch[] = [];
    // W wins a six-team L3.
    games.push(...season('L3', ['G', 'H', 'I', 'J', 'K', 'W'], 'W', 'win'));
    games.push(...lower());
    games.push(match(200, 'W', 'p', 1, 1, 'L2'));
    const { before } = replay(games);
    const [w, p] = before.get(games[games.length - 1].id)!;
    expect(w).toBeLessThan(p);
  });

  it('does not move a team for a cup match in another competition', () => {
    const games = [match(0, 'A', 'B', 1, 0), match(1, 'A', 'Z', 1, 0, 'CUP', false)];
    const { ratings } = replay(games);
    expect(ratings.get('A')!.leagueId).toBe('L1');
  });

  it('needs enough matches to say where a team finished', () => {
    expect(finishedInUpperHalf('R', [match(0, 'A', 'R', 1, 0)], day(1))).toBeNull();
  });
});

describe('compareSides', () => {
  it('calls close matches even', () => {
    expect(compareSides(1500, 1560).stronger).toBe('EVEN');
    expect(compareSides(1600, 1450).stronger).toBe('HOME');
    expect(compareSides(1400, 1600).stronger).toBe('AWAY');
  });
});
