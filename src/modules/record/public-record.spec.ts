import { RecordService } from './record.service';

const match = { eventId: 'e1', kickoffAt: new Date('2026-10-08T15:00:00Z'), home: 'A', away: 'B', score: '2–1', league: 'L', country: 'X', international: false };
const rate = { settled: 2, won: 1, rate: 0.5, expected: 0.6 };

describe('RecordService.publicRecord', () => {
  it('shows settled picks and clusters only, without how the chance was worked out, and caches', async () => {
    const svc = new RecordService({} as any);
    const daily = jest.spyOn(svc, 'daily').mockResolvedValue({
      days: [{ date: '2026-10-08', streaks: rate, evidence: rate, clusters: rate }],
      totals: { streaks: rate, evidence: rate, clusters: rate },
      from: '2026-10-03',
      to: '2026-10-09',
    } as any);
    jest.spyOn(svc, 'day').mockResolvedValue({
      date: '2026-10-08',
      matches: [{ match, items: [
        { label: 'Over 1.5', result: 'WIN', probability: 0.8, tier: 'evidence', driver: 'form' },
        { label: 'BTTS', result: 'VOID', probability: 0.6, tier: 'evidence', driver: 'season' },
      ] }],
      clusters: [
        { id: 'c1', date: new Date(), tier: 'SAFE', combinedProbability: 0.4, outcome: 'LOSS', international: false, firstKickoff: 0, lastKickoff: 0, legs: [{ match, label: 'Over 1.5', result: 'WIN', probability: 0.8 }] },
        { id: 'c2', date: new Date(), tier: 'SAFE', combinedProbability: 0.4, outcome: 'PENDING', international: false, firstKickoff: 0, lastKickoff: 0, legs: [] },
      ],
    } as any);

    (svc as any).streakItems = jest.fn().mockResolvedValue([
      { probability: 0.7, result: 'WIN' },
      { probability: 0.4, result: 'LOSS' },
    ]);

    const res: any = await svc.publicRecord();
    expect([res.calibration.days, res.calibration.strong.settled, res.calibration.strong.won]).toEqual([30, 1, 1]);
    const day = res.days[0];
    expect(day.matches[0].picks).toEqual([{ label: 'Over 1.5', chance: 0.8, result: 'WIN' }]);
    expect(day.matches[0].match.eventId).toBeUndefined();
    expect(day.clusterList).toHaveLength(1);
    expect(JSON.stringify(res)).not.toContain('driver');

    await svc.publicRecord();
    expect(daily).toHaveBeenCalledTimes(1);
  });
});
