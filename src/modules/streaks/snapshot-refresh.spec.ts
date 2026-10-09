import { SnapshotsService } from './snapshots.service';

const hour = 3600e3;

function setup(oldCutoffInFuture: boolean) {
  const kickoff = new Date(Date.now() + 10 * hour);
  const candidate = {
    id: 'cand-new', entityId: 'flamengo', marketDefinitionId: 'def-ah', selection: null,
    hitRate: 0.97, baselineRate: 0.83, lift: 0.14, sampleSize: 60, currentStreak: 9, strengthScore: 2, survivedGate: true,
  };
  const snapshots = [
    {
      id: 'snap-old', eventId: 'santos-flamengo', streakCandidateId: 'cand-old',
      dataCutoffAt: new Date(Date.now() + (oldCutoffInFuture ? 9 : -1) * hour),
      streakCandidate: { marketDefinitionId: 'def-ah', selection: null, entityId: 'flamengo' },
    },
  ];
  const updates: Array<{ id: string; data: any }> = [];
  const prisma: any = {
    engineRun: { findFirst: async () => ({ id: 'run-2' }) },
    streakCandidate: { findMany: async ({ where }: any) => (where.survivedGate === true ? [candidate] : []) },
    event: { findMany: async () => [{ id: 'santos-flamengo', kickoffAt: kickoff, homeTeamId: 'santos', awayTeamId: 'flamengo', leagueId: 'serie-a' }] },
    marketDefinition: { findMany: async () => [{ id: 'def-ah', marketId: 'AH_PLUS_1_5' }] },
    $queryRaw: async () => [],
    streakSnapshot: {
      findMany: async ({ where }: any) => (where.eventId ? snapshots : []),
      update: async ({ where, data }: any) => updates.push({ id: where.id, data }),
      createMany: async () => {
        throw new Error('a second snapshot of the same bet must not be created');
      },
    },
  };
  return { svc: new SnapshotsService(prisma), updates };
}

describe('capturing a bet already captured', () => {
  it('brings it up to date with the latest run before its cutoff', async () => {
    const { svc, updates } = setup(true);
    const res: any = await svc.captureForUpcoming({ includeSuggestive: false });
    expect(res.refreshed).toBe(1);
    expect(updates[0]).toMatchObject({ id: 'snap-old', data: { streakCandidateId: 'cand-new', hitRate: 0.97 } });
  });

  it('leaves it alone once its cutoff has passed: that is the record', async () => {
    const { svc, updates } = setup(false);
    const res: any = await svc.captureForUpcoming({ includeSuggestive: false });
    expect(res.refreshed).toBe(0);
    expect(updates).toHaveLength(0);
  });
});
