import { legProbability, legSide, modelMarketName } from './streak-leg';
import { parseLeg } from './builder-math';

const teams = { home: 'York', away: 'Northampton' };

describe('streak legs', () => {
  it('maps to the model market names the builder already understands', () => {
    expect(modelMarketName('MATCH_OVER_2_5', 'MATCH', teams)).toBe('Match Goals: Over 2.5');
    expect(modelMarketName('TEAM_UNDER_1_5', 'AWAY', teams)).toBe('Northampton Goals: Under 1.5');
    expect(modelMarketName('MATCH_CORNERS_OVER_8_5', 'MATCH', teams)).toBe('Match Corners: Over 8.5');
    expect(modelMarketName('BTTS_NO', 'MATCH', teams)).toBe('Both Teams to Score — No');
    expect(modelMarketName('TEAM_WIN', 'HOME', teams)).toBe('York to Win');
    expect(modelMarketName('HT_OVER_0_5', 'MATCH', teams)).toBeNull();
  });

  it('keeps the builder conflict checks working on mapped names', () => {
    const over = parseLeg({ category: 'GOALS', name: modelMarketName('TEAM_OVER_1_5', 'AWAY', teams)! });
    expect(over).toEqual({ kind: 'total', subject: 'northampton goals', side: 'Over', line: 1.5 });
  });

  it('places a team streak on its side of the fixture', () => {
    const event = { homeTeamId: 'york', awayTeamId: 'nor' };
    expect(legSide('TEAM', 'nor', event)).toBe('AWAY');
    expect(legSide('MATCH', 'nor', event)).toBe('MATCH');
    expect(legSide('TEAM', 'someone-else', event)).toBeNull();
  });

  it('never treats a record as certain', () => {
    expect(legProbability(1)).toBe(0.97);
    expect(legProbability(NaN)).toBe(0.5);
  });
});
