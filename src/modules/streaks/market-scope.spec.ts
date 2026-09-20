import { marketScope, MARKET_DEFINITIONS } from './market-definitions';
import { streakMarketLabel, marketSubjectOf } from '@/common/market-copy';

/**
 * From the client, about the Clusters page:
 *
 *   "Only 1 team can be selected for the draw no bet market. It's not a
 *    combined market. It does not cover the two teams. Which one is it?"
 *   "The system should be adjusted to show when it's referring to one team,
 *    and when it's referring to the combined 2 teams. (total)"
 *
 * Every row read "Both teams combined", because the card inferred the subject
 * from the candidate's `selection` — which is null for venue-agnostic slices,
 * i.e. most of them. Scope comes from the market definition now.
 */
describe('market scope', () => {
  it('treats the markets the client named as single-team', () => {
    expect(marketScope('DRAW_NO_BET')).toBe('TEAM');
    expect(marketScope('TEAM_WIN')).toBe('TEAM');
    expect(marketScope('TEAM_UNDER_1_5')).toBe('TEAM');
    expect(marketScope('TEAM_WIN_TO_NIL_NO')).toBe('TEAM');
    expect(marketScope('TEAM_OVER_0_5')).toBe('TEAM');
  });

  it('treats match totals as covering both teams', () => {
    expect(marketScope('MATCH_OVER_2_5')).toBe('MATCH');
    expect(marketScope('MATCH_UNDER_3_5')).toBe('MATCH');
    expect(marketScope('BTTS_YES')).toBe('MATCH');
    expect(marketScope('MATCH_CORNERS_OVER_8_5')).toBe('MATCH');
    expect(marketScope('DOUBLE_CHANCE_HOME_OR_AWAY')).toBe('MATCH');
  });

  it('gives every registered market a scope', () => {
    for (const spec of MARKET_DEFINITIONS) {
      expect(['TEAM', 'MATCH']).toContain(marketScope(spec.marketId));
    }
  });

  it('falls back to match scope for an unknown market rather than naming a team', () => {
    expect(marketScope('SOMETHING_NEW')).toBe('MATCH');
  });

  // Asian handicaps and double chance for a team are one-sided too; a reader
  // taking them as covering both clubs would have the bet wrong.
  it('treats handicaps and team double chance as single-team', () => {
    expect(marketScope('AH_MINUS_1_5')).toBe('TEAM');
    expect(marketScope('AH_PLUS_2_5')).toBe('TEAM');
    expect(marketScope('DOUBLE_CHANCE_TEAM_OR_DRAW')).toBe('TEAM');
    expect(marketScope('OPPONENT_UNDER_1_5')).toBe('TEAM');
  });
});

describe('streakMarketLabel', () => {
  it('replaces the generic "Team" with the club', () => {
    expect(streakMarketLabel('Team To Win', 'TEAM', 'Atletico Madrid')).toBe(
      'Atletico Madrid To Win',
    );
    expect(streakMarketLabel('Team Under 1.5 Goals', 'TEAM', 'Energie Cottbus')).toBe(
      'Energie Cottbus Under 1.5 Goals',
    );
    expect(streakMarketLabel('Team Win To Nil — No', 'TEAM', 'Hellas Verona')).toBe(
      'Hellas Verona Win To Nil — No',
    );
  });

  it('names the club on a market with no placeholder', () => {
    expect(streakMarketLabel('Draw No Bet', 'TEAM', 'Marseille')).toBe(
      'Marseille — Draw No Bet',
    );
  });

  it('leaves match markets alone', () => {
    expect(streakMarketLabel('Match Over 2.5 Goals', 'MATCH', null)).toBe(
      'Match Over 2.5 Goals',
    );
    expect(streakMarketLabel('Both Teams To Score', 'MATCH', null)).toBe(
      'Both Teams To Score',
    );
  });

  it('does not invent a club when the team is unknown', () => {
    expect(streakMarketLabel('Team To Win', 'TEAM', null)).toBe('Team To Win');
  });
});

describe('marketSubjectOf', () => {
  it('says one team, and says it is not the total', () => {
    const s = marketSubjectOf('TEAM', 'Marseille');
    expect(s.scope).toBe('TEAM');
    expect(s.team).toBe('Marseille');
    expect(s.label).toBe('Marseille only — not the match total');
  });

  it('says both teams for a match total', () => {
    const s = marketSubjectOf('MATCH', null);
    expect(s.scope).toBe('MATCH');
    expect(s.team).toBeNull();
    expect(s.label).toBe('Both teams combined — match total');
  });

  it('never calls a single-team market combined, even with no club resolved', () => {
    const s = marketSubjectOf('TEAM', null);
    expect(s.label).toBe('One team only — not the match total');
    expect(s.label).not.toMatch(/both teams/i);
  });

  it('no single-team market is ever described as combined', () => {
    for (const spec of MARKET_DEFINITIONS) {
      const scope = marketScope(spec.marketId);
      if (scope !== 'TEAM') continue;
      const label = marketSubjectOf(scope, 'Marseille').label;
      expect(label).not.toMatch(/both teams|combined/i);
    }
  });
});
