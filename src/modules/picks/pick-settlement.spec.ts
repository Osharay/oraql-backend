import { settlePick } from './pick-settlement';

const teams = { home: 'York', away: 'Barnet' };

describe('settlePick', () => {
  it('settles results', () => {
    expect(settlePick('York to Win', { homeGoals: 2, awayGoals: 1 }, teams)).toBe('WIN');
    expect(settlePick('Barnet to Win', { homeGoals: 2, awayGoals: 1 }, teams)).toBe('LOSS');
    expect(settlePick('Draw', { homeGoals: 1, awayGoals: 1 }, teams)).toBe('WIN');
  });

  it('settles goals, team goals and BTTS', () => {
    expect(settlePick('Match Goals: Over 2.5', { homeGoals: 2, awayGoals: 1 }, teams)).toBe('WIN');
    expect(settlePick('Match Goals: Under 2.5', { homeGoals: 2, awayGoals: 1 }, teams)).toBe('LOSS');
    expect(settlePick('Barnet Goals: Under 1.5', { homeGoals: 2, awayGoals: 1 }, teams)).toBe('WIN');
    expect(settlePick('Both Teams to Score — Yes', { homeGoals: 2, awayGoals: 0 }, teams)).toBe('LOSS');
    expect(settlePick('Both Teams to Score — No', { homeGoals: 2, awayGoals: 0 }, teams)).toBe('WIN');
  });

  it('settles corners and cards only with statistics', () => {
    expect(settlePick('Match Corners: Over 9.5', { homeGoals: 0, awayGoals: 0, homeCorners: 6, awayCorners: 5 }, teams)).toBe('WIN');
    expect(settlePick('Match Corners: Over 9.5', { homeGoals: 0, awayGoals: 0 }, teams)).toBe('UNKNOWN');
    expect(settlePick('Match Cards: Under 3.5', { homeGoals: 0, awayGoals: 0, homeCards: 2, awayCards: 3 }, teams)).toBe('LOSS');
  });

  it('never guesses', () => {
    expect(settlePick('Something Else', { homeGoals: 1, awayGoals: 0 }, teams)).toBe('UNKNOWN');
    expect(settlePick('York to Win', { homeGoals: null, awayGoals: 0 }, teams)).toBe('UNKNOWN');
  });
});
