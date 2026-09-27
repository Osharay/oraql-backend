import { seasonFor, seasonStartMonth } from './season-infer';

//             J   F   M   A   M   J  J   A   S   O   N   D
const europe = [40, 40, 40, 40, 30, 2, 3, 30, 40, 40, 40, 40];
const brazil = [3, 20, 40, 40, 40, 40, 40, 40, 40, 40, 40, 30];

describe('season inference', () => {
  it('finds a European break and names seasons by their start year', () => {
    const start = seasonStartMonth(europe);
    expect(start).toBe(7);
    expect(seasonFor(new Date('2026-03-14T15:00:00Z'), start)).toBe(2025);
    expect(seasonFor(new Date('2026-09-20T15:00:00Z'), start)).toBe(2026);
  });

  it('finds a calendar-year league', () => {
    const start = seasonStartMonth(brazil);
    expect(start).toBe(2);
    expect(seasonFor(new Date('2026-11-01T20:00:00Z'), start)).toBe(2026);
    expect(seasonFor(new Date('2026-04-01T20:00:00Z'), start)).toBe(2026);
  });

  it('falls back to July with too little to go on', () => {
    expect(seasonStartMonth([1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])).toBe(7);
  });
});
