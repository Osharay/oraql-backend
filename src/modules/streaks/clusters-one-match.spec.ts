import { ClustersService } from './clusters.service';

const kickoff = new Date(Date.now() + 6 * 3600e3);
const snap = (id: string, eventId: string, market: string, chance: number) => ({
  id,
  hitRate: chance,
  lift: 0.2,
  strengthScore: 1,
  eventId,
  event: { leagueId: `league-${eventId}` },
  streakCandidate: {
    marketDefinitionId: `def-${market}`,
    survivedGate: true,
    selection: 'HOME',
    entityId: `team-${eventId}`,
    context: { chance },
    marketDefinition: { marketId: market },
  },
});

describe('OraQL clusters on one day', () => {
  it('use each match in one cluster only', async () => {
    // Flamengo's match has three strong, different bets; the others one each.
    const snapshots = [
      snap('s1', 'flamengo', 'TEAM_OVER_0_5', 0.86),
      snap('s2', 'flamengo', 'AH_PLUS_1_5', 0.9),
      snap('s3', 'flamengo', 'DOUBLE_CHANCE_TEAM_OR_DRAW', 0.86),
      snap('s4', 'berkane', 'DRAW_NO_BET', 0.81),
      snap('s5', 'far-rabat', 'TEAM_UNDER_1_5', 0.84),
      snap('s6', 'novorizontino', 'OPPONENT_UNDER_1_5', 0.8),
      snap('s7', 'shakhtar', 'TEAM_WIN', 0.75),
      snap('s8', 'qadisiyah', 'BTTS_NO', 0.7),
    ].map((s) => ({ ...s, kickoffAt: kickoff }));
    const created: Array<{ components: string[] }> = [];
    const prisma: any = {
      streakSnapshot: { findMany: async () => snapshots },
      cluster: {
        findMany: async () => [],
        deleteMany: async () => ({ count: 0 }),
        create: async () => {
          created.push({ components: [] });
          return { id: `c${created.length}` };
        },
      },
      clusterComponent: {
        createMany: async ({ data }: any) => {
          created[created.length - 1].components = data.map((d: any) => d.snapshotId);
        },
      },
    };

    await new ClustersService(prisma).buildForDate({});

    const eventOf = new Map(snapshots.map((s) => [s.id, s.eventId]));
    const events = created.flatMap((c) => c.components.map((id) => eventOf.get(id)));
    expect(created.length).toBeGreaterThan(1);
    expect(new Set(events).size).toBe(events.length); // no match twice
  });
});

describe('a snapshot from before the honest chances', () => {
  it('is built in at its honest chance, never its raw 100%', async () => {
    const kickoffAt = new Date(Date.now() + 6 * 3600e3);
    const old = (id: string, eventId: string, market: string, hitRate: number, sampleSize: number, baselineRate: number) => ({
      id, hitRate, sampleSize, baselineRate, lift: 0.1, strengthScore: 1, eventId, kickoffAt,
      event: { leagueId: `l-${eventId}` },
      streakCandidate: {
        marketDefinitionId: `d-${market}`, survivedGate: true, selection: 'HOME', entityId: `t-${eventId}`,
        context: {}, // no chance stored by that run
        marketDefinition: { marketId: market },
      },
    });
    const snapshots = [
      old('a', 'fluminense', 'AH_PLUS_2_5', 1, 92, 0.93),
      old('b', 'fortaleza', 'TEAM_UNDER_2_5', 0.987, 77, 0.88),
      old('c', 'palmeiras', 'AH_PLUS_1_5', 0.967, 92, 0.83),
    ];
    let stored: Array<{ snapshotId: string; chance: number }> = [];
    let combined = 0;
    const prisma: any = {
      streakSnapshot: { findMany: async () => snapshots },
      cluster: {
        findMany: async () => [],
        deleteMany: async () => ({ count: 0 }),
        create: async ({ data }: any) => {
          combined = data.combinedProbability;
          return { id: 'c1' };
        },
      },
      clusterComponent: { createMany: async ({ data }: any) => (stored = data) },
    };
    await new ClustersService(prisma).buildForDate({});
    expect(stored.length).toBe(3);
    for (const leg of stored) expect(leg.chance).toBeLessThanOrEqual(0.9);
    expect(combined).toBeLessThanOrEqual(0.9 ** 3 + 1e-9);
  });
});
