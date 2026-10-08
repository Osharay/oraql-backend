import { canDelete, cannotSave, clusterState, sourceLabel } from './custom-cluster-rules';

const now = new Date('2026-10-08T12:00:00Z');
const later = new Date('2026-10-08T15:00:00Z');
const earlier = new Date('2026-10-08T11:00:00Z');
const sel = (label: string, kickoffAt = later, status = 'SCHEDULED') => ({ label, kickoffAt, status });

describe('cannotSave', () => {
  it('needs at least two selections', () => {
    expect(cannotSave([sel('A')], now)).toMatch(/at least 2/);
  });

  it('allows two or more matches still to start', () => {
    expect(cannotSave([sel('A'), sel('B', later, 'LINEUP_CONFIRMED')], now)).toBeNull();
  });

  it('refuses a selection whose match has kicked off, naming it', () => {
    expect(cannotSave([sel('A'), sel('Arsenal v Spurs', earlier)], now)).toMatch(/Arsenal v Spurs has already started/);
  });

  it('refuses a match that is live or called off even before its listed time', () => {
    expect(cannotSave([sel('A'), sel('B', later, 'POSTPONED')], now)).toMatch(/B has already started/);
  });

  it('caps the size', () => {
    expect(cannotSave(Array.from({ length: 21 }, (_, i) => sel(`M${i}`)), now)).toMatch(/up to 20/);
  });
});

describe('canDelete', () => {
  it('only before the first match starts', () => {
    expect(canDelete(later, now)).toBe(true);
    expect(canDelete(earlier, now)).toBe(false);
  });
});

describe('clusterState', () => {
  it('is upcoming while nothing has started', () => {
    expect(clusterState([{ result: null, kickoffAt: later }], now)).toBe('UPCOMING');
  });

  it('is in play once a match has started and nothing has lost', () => {
    expect(clusterState([{ result: 'WIN', kickoffAt: earlier }, { result: null, kickoffAt: later }], now)).toBe('IN_PLAY');
  });

  it('is settled as soon as one selection loses', () => {
    expect(clusterState([{ result: 'LOSS', kickoffAt: earlier }, { result: null, kickoffAt: later }], now)).toBe('SETTLED');
  });

  it('is settled when every selection has a result', () => {
    expect(clusterState([{ result: 'WIN', kickoffAt: earlier }, { result: 'VOID', kickoffAt: earlier }], now)).toBe('SETTLED');
  });
});

describe('sourceLabel', () => {
  it('names streak tiers and match-page markets', () => {
    expect(sourceLabel('STREAK_EVIDENCE', 'MODEL')).toBe('Evidence-backed streak');
    expect(sourceLabel('STREAK_EXPLORATORY', 'STREAK')).toBe('Exploratory streak');
    expect(sourceLabel(null, 'MODEL')).toBe('Match market');
  });
});
