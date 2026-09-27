import { bandOf, sidesFor, splitByOpponent } from './opponent-split';

describe('opponent split', () => {
  it('bands opponents by the rating gap at the time', () => {
    expect(bandOf(1500, 1600)).toBe('STRONGER');
    expect(bandOf(1500, 1540)).toBe('SIMILAR');
    expect(bandOf(1500, 1400)).toBe('WEAKER');
  });

  it('counts wins and matches in each band, and keeps unrated apart', () => {
    const split = splitByOpponent([
      { result: 'WIN', teamRating: 1500, opponentRating: 1400 },
      { result: 'WIN', teamRating: 1500, opponentRating: 1390 },
      { result: 'LOSS', teamRating: 1500, opponentRating: 1620 },
      { result: 'WIN', teamRating: 1500, opponentRating: 1520 },
      { result: 'WIN', teamRating: null, opponentRating: 1520 },
      { result: 'VOID', teamRating: 1500, opponentRating: 1400 },
    ]);
    expect(split).toEqual({
      stronger: { wins: 0, played: 1 },
      similar: { wins: 1, played: 1 },
      weaker: { wins: 2, played: 2 },
      unrated: 1,
    });
  });

  it('reads the right rating for each side', () => {
    expect(sidesFor(true, 1550, 1450)).toEqual({ teamRating: 1550, opponentRating: 1450 });
    expect(sidesFor(false, 1550, 1450)).toEqual({ teamRating: 1450, opponentRating: 1550 });
  });
});
