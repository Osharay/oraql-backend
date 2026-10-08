import { contradicts, dropContradictions } from './contradictions';

const crb = 'crb';
const atl = 'atletico';

describe('contradicts', () => {
  it('both teams to lead at half-time and win', () => {
    expect(contradicts({ marketId: 'HTFT_TEAM_TEAM', team: crb }, { marketId: 'HTFT_TEAM_TEAM', team: atl })).toBe(true);
  });

  it('one team to win and the match drawn', () => {
    expect(contradicts({ marketId: 'TEAM_WIN', team: crb }, { marketId: 'DRAW', team: null })).toBe(true);
  });

  it('one team to win and the other not to lose', () => {
    expect(contradicts({ marketId: 'TEAM_WIN', team: crb }, { marketId: 'DOUBLE_CHANCE_TEAM_OR_DRAW', team: atl })).toBe(true);
    expect(contradicts({ marketId: 'TEAM_WIN', team: crb }, { marketId: 'DOUBLE_CHANCE_TEAM_OR_DRAW', team: crb })).toBe(false);
  });

  it('over and under where the lines cross, but not where both can land', () => {
    expect(contradicts({ marketId: 'MATCH_OVER_2_5', team: null }, { marketId: 'MATCH_UNDER_2_5', team: null })).toBe(true);
    expect(contradicts({ marketId: 'MATCH_OVER_2_5', team: null }, { marketId: 'MATCH_UNDER_3_5', team: null })).toBe(false);
    expect(contradicts({ marketId: 'TEAM_OVER_1_5', team: crb }, { marketId: 'TEAM_UNDER_1_5', team: crb })).toBe(true);
    expect(contradicts({ marketId: 'TEAM_OVER_1_5', team: crb }, { marketId: 'TEAM_UNDER_1_5', team: atl })).toBe(false);
  });

  it('both teams to score yes and no, and a clean sheet against the other side scoring', () => {
    expect(contradicts({ marketId: 'BTTS_YES', team: null }, { marketId: 'BTTS_NO', team: null })).toBe(true);
    expect(contradicts({ marketId: 'TEAM_CLEAN_SHEET_YES', team: crb }, { marketId: 'TEAM_OVER_0_5', team: atl })).toBe(true);
    expect(contradicts({ marketId: 'TEAM_CLEAN_SHEET_YES', team: crb }, { marketId: 'BTTS_YES', team: null })).toBe(true);
  });

  it('leaves compatible picks alone', () => {
    expect(contradicts({ marketId: 'TEAM_WIN', team: crb }, { marketId: 'MATCH_OVER_1_5', team: null })).toBe(false);
    expect(contradicts({ marketId: 'BTTS_NO', team: null }, { marketId: 'TEAM_CLEAN_SHEET_YES', team: crb })).toBe(false);
  });
});

describe('dropContradictions', () => {
  const pick = (id: string, event: string, marketId: string, team: string | null, chance: number) => ({ id, event, marketId, team, chance });

  it('keeps the likelier of two opposite picks on a match, in the original order', () => {
    const items = [
      pick('a', 'e1', 'HTFT_TEAM_TEAM', atl, 0.38),
      pick('b', 'e1', 'HTFT_TEAM_TEAM', crb, 0.4),
      pick('c', 'e1', 'MATCH_OVER_0_5', null, 0.8),
      pick('d', 'e2', 'HTFT_TEAM_TEAM', atl, 0.3),
    ];
    const kept = dropContradictions(items, (p) => p.event, (p) => p, (p) => p.chance).map((p) => p.id);
    expect(kept).toEqual(['b', 'c', 'd']);
  });
});
