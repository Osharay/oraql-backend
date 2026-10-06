import { londonDay, londonDayBounds, londonDayStart } from './london-day';

describe('london-day', () => {
  it('puts a late summer evening kickoff on its UK day', () => {
    expect(londonDay(new Date('2026-07-10T22:30:00Z'))).toBe('2026-07-10');
    expect(londonDay(new Date('2026-07-10T23:30:00Z'))).toBe('2026-07-11');
  });

  it('puts a winter kickoff on its UK day', () => {
    expect(londonDay(new Date('2026-12-10T23:30:00Z'))).toBe('2026-12-10');
  });

  it('starts a summer day at 23:00 UTC the evening before', () => {
    expect(londonDayStart('2026-07-10')!.toISOString()).toBe('2026-07-09T23:00:00.000Z');
  });

  it('starts a winter day at midnight UTC', () => {
    expect(londonDayStart('2026-12-10')!.toISOString()).toBe('2026-12-10T00:00:00.000Z');
  });

  it('gives the clocks-back day 25 hours', () => {
    const b = londonDayBounds('2026-10-25')!;
    expect(b.start.toISOString()).toBe('2026-10-24T23:00:00.000Z');
    expect(b.end.toISOString()).toBe('2026-10-26T00:00:00.000Z');
  });

  it('gives the clocks-forward day 23 hours', () => {
    const b = londonDayBounds('2026-03-29')!;
    expect(b.start.toISOString()).toBe('2026-03-29T00:00:00.000Z');
    expect(b.end.toISOString()).toBe('2026-03-29T23:00:00.000Z');
  });

  it('rejects a malformed date', () => {
    expect(londonDayStart('5 Oct')).toBeNull();
  });
});
