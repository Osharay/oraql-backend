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

  // Team totals are the betable form of an "over 0.5": the client's point was
  // that over 0.5 on the match total is barely priced, while over 0.5 for one
  // team is a real market.
  describe('team totals', () => {
    it('reads over 0.5 as the team scoring', () => {
      expect(describeMarket('Arsenal Goals: Over 0.5', fixture)).toBe(
        'Arsenal scores at least once (full match)',
      );
    });

    it('reads over 1.5 as two or more', () => {
      expect(describeMarket('Man City Goals: Over 1.5', fixture)).toBe(
        'Man City scores 2 or more (full match)',
      );
    });

    it('reads under 0.5 as failing to score', () => {
      expect(describeMarket('Arsenal Goals: Under 0.5', fixture)).toBe(
        'Arsenal fails to score (full match)',
      );
    });

    it('reads under 1.5 as at most once', () => {
      expect(describeMarket('Arsenal Goals: Under 1.5', fixture)).toBe(
        'Arsenal scores at most once (full match)',
      );
    });

    it('does not mistake a match total for a team total', () => {
      expect(describeMarket('Match Goals: Over 1.5', fixture)).toBe(
        'More than 1.5 goals in the match (both teams combined)',
      );
    });

    it('handles a club whose name contains the word Match', () => {
      expect(describeMarket('Matchroom FC Goals: Over 0.5', fixture)).toBe(
        'Matchroom FC scores at least once (full match)',
      );
    });
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
    expect(describeMarket('Both Teams to Score — Yes', fixture)).toBe(
      'Both teams score at least once (full match)',
    );
    expect(describeMarket('Both Teams to Score — No', fixture)).toBe(
      'At least one team fails to score (full match)',
    );
  });

  it('falls back to the stored name rather than inventing one', () => {
    expect(describeMarket('Anytime Goalscorer: Saka', fixture)).toBe('Anytime Goalscorer: Saka');
  });
});
