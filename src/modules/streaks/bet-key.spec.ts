import { betKey } from './bet-key';

describe('betKey', () => {
  const base = { eventId: 'e1', marketDefinitionId: 'm1', entityId: 'home' };

  it('treats a fixture market from either team as one bet', () => {
    expect(betKey({ ...base, selection: 'MATCH' })).toBe(betKey({ ...base, entityId: 'away', selection: 'MATCH' }));
  });

  it('treats the same team market from different evidence slices as one bet', () => {
    expect(betKey({ ...base, selection: 'HOME' })).toBe(betKey({ ...base, selection: null }));
  });

  it('keeps the two teams apart on a team market', () => {
    expect(betKey({ ...base, selection: null })).not.toBe(betKey({ ...base, entityId: 'away', selection: null }));
  });

  it('keeps different matches and markets apart', () => {
    expect(betKey({ ...base, selection: 'MATCH' })).not.toBe(betKey({ ...base, eventId: 'e2', selection: 'MATCH' }));
    expect(betKey({ ...base, selection: 'MATCH' })).not.toBe(betKey({ ...base, marketDefinitionId: 'm2', selection: 'MATCH' }));
  });
});
