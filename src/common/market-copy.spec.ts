import { describeMarket } from './market-copy';

const fixture = {
  homeTeam: { name: 'Arsenal', shortName: 'Arsenal' },
  awayTeam: { name: 'Manchester City', shortName: 'Man City' },
};

describe('describeMarket', () => {
  it('names the subject of a goals line, which the market name alone does not', () => {
    // The exact card that had a client asking which team the over 0.5 belonged to.
    expect(describeMarket('Over 0.5 Goals', fixture)).toBe(
      'More than 0.5 goals in the match (both teams combined)',
    );
  });

  it('reads the current naming as well as the old', () => {
    expect(describeMarket('Match Goals: Over 2.5', fixture)).toBe(
      'More than 2.5 goals in the match (both teams combined)',
    );
  });

  it('handles under lines and other metrics', () => {
    expect(describeMarket('Match Corners: Under 9.5', fixture)).toBe(
      'Fewer than 9.5 corners in the match (both teams combined)',
    );
    expect(describeMarket('Under 3.5 Cards', fixture)).toBe(
      'Fewer than 3.5 cards in the match (both teams combined)',
    );
  });

  it('names the club on a result market', () => {
    expect(describeMarket('Arsenal to Win', fixture)).toBe('Arsenal wins the match (90 minutes)');
  });

  it('resolves legacy home/away names against the fixture', () => {
    expect(describeMarket('Home Win', fixture)).toBe('Arsenal wins the match (90 minutes)');
    expect(describeMarket('Away Win', fixture)).toBe('Man City wins the match (90 minutes)');
  });

  it('degrades safely with no fixture in hand', () => {
    expect(describeMarket('Home Win')).toBe('The home team wins the match (90 minutes)');
  });

  it('covers draw and both-teams-to-score', () => {
    expect(describeMarket('Draw', fixture)).toBe('The match ends level (90 minutes)');
    expect(describeMarket('Both Teams to Score - Yes', fixture)).toBe(
      'Both teams score at least once (full match)',
    );
    expect(describeMarket('Both Teams to Score - No', fixture)).toBe(
      'At least one team fails to score (full match)',
    );
  });

  it('falls back to the stored name rather than inventing one', () => {
    expect(describeMarket('Anytime Goalscorer: Saka', fixture)).toBe('Anytime Goalscorer: Saka');
  });
});
