import { absenceBearing, absenceVerdict, contributionShares, summariseAvailability } from './availability';

const france = [
  { id: 'mbappe', name: 'K. Mbappé', goals: 20, assists: 6 },
  { id: 'dembele', name: 'O. Dembélé', goals: 8, assists: 10 },
  { id: 'thuram', name: 'M. Thuram', goals: 6, assists: 2 },
  { id: 'kante', name: 'N. Kanté', goals: 1, assists: 2 },
  { id: 'maignan', name: 'M. Maignan', goals: 0, assists: 0 },
];

describe('availability', () => {
  it('weighs players by their share of goals plus half assists', () => {
    const shares = contributionShares(france)!;
    expect(shares.get('mbappe')!).toBeGreaterThan(0.5);
    expect(shares.get('maignan')).toBe(0);
  });

  it('calls it major when the top scorer is out', () => {
    const a = summariseAvailability(france, [{ playerId: 'mbappe', status: 'Out', reason: 'Ankle' }], null);
    expect(a.level).toBe('MAJOR');
    expect(a.missing[0]).toMatchObject({ name: 'K. Mbappé', kind: 'ABSENT' });
  });

  it('counts a key player left out of a confirmed XI', () => {
    const a = summariseAvailability(france, [], { starters: ['mbappe', 'kante', 'maignan'] });
    expect(a.lineupConfirmed).toBe(true);
    expect(a.missing.map((m) => m.name)).toEqual(['O. Dembélé', 'M. Thuram']);
    expect(a.missing[0].kind).toBe('BENCHED');
    expect(a.level).toBe('MAJOR'); // Dembélé + Thuram are well over a quarter
  });

  it('keeps a minor absence minor', () => {
    const a = summariseAvailability(france, [{ playerId: 'kante', status: 'Out' }], null);
    expect(a.level).toBe('NONE');
    const b = summariseAvailability(france, [{ playerId: 'thuram', status: 'Out' }], null);
    expect(b.level).toBe('MINOR');
  });

  it('does not guess when there are no numbers', () => {
    const bare = france.map((p) => ({ id: p.id, name: p.name }));
    const a = summariseAvailability(bare, [{ playerId: 'mbappe', status: 'Out' }], null);
    expect(a.level).toBe('UNKNOWN');
    expect(a.statsKnown).toBe(false);
    expect(a.missing[0].share).toBeNull();
  });

  it('knows which way an absence cuts for each market', () => {
    expect(absenceBearing('TEAM_CORNERS_OVER_4_5')).toEqual({ side: 'OWN', effect: 'HURTS' });
    expect(absenceBearing('TEAM_UNDER_1_5')).toEqual({ side: 'OWN', effect: 'HELPS' });
    expect(absenceBearing('MATCH_OVER_2_5')).toEqual({ side: 'BOTH', effect: 'HURTS' });
    expect(absenceBearing('TEAM_CLEAN_SHEET_YES')).toEqual({ side: 'OPPONENT', effect: 'HELPS' });
    expect(absenceBearing('DRAW')).toBeNull();
  });

  it('turns both sides into one verdict for a card', () => {
    const out = summariseAvailability(france, [{ playerId: 'mbappe', status: 'Out' }], null);
    const fine = summariseAvailability(france, [], null);
    expect(absenceVerdict('TEAM_OVER_1_5', out, fine)).toEqual({ effect: 'HURTS', level: 'MAJOR' });
    expect(absenceVerdict('TEAM_OVER_1_5', fine, out)).toBeNull();
    expect(absenceVerdict('MATCH_UNDER_2_5', fine, out)).toEqual({ effect: 'HELPS', level: 'MAJOR' });
  });
});
