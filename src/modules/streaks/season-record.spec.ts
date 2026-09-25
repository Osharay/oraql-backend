import { currentSeasonRecord } from './season-record';

describe('currentSeasonRecord', () => {
  it('counts only the latest season, settled rows only', () => {
    const rows = [
      { season: 2025, result: 'WIN' },
      { season: 2025, result: 'WIN' },
      { season: 2026, result: 'WIN' },
      { season: 2026, result: 'LOSS' },
      { season: 2026, result: 'LOSS' },
      { season: 2026, result: 'VOID' },
    ];
    expect(currentSeasonRecord(rows)).toEqual({ season: 2026, wins: 1, played: 3 });
  });

  it('is null with nothing settled', () => {
    expect(currentSeasonRecord([])).toBeNull();
    expect(currentSeasonRecord([{ season: 2026, result: 'UNKNOWN' }])).toBeNull();
  });
});
