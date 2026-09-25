// The enums as the real client defines them, so the test does not depend on
// the locally generated client being current.
jest.mock('@prisma/client', () => {
  const actual = jest.requireActual('@prisma/client');
  const enums: Record<string, unknown> = {
    ObservationResult: { WIN: 'WIN', LOSS: 'LOSS', VOID: 'VOID', UNKNOWN: 'UNKNOWN' },
    ObservationSelection: { HOME: 'HOME', AWAY: 'AWAY', MATCH: 'MATCH' },
  };
  return new Proxy(actual, {
    get: (target, key: string) => (key in enums ? enums[key] : target[key]),
  });
});

import { CandidatesService } from './candidates.service';

const day = (n: number) => new Date(Date.now() - n * 86_400_000);

function service(overrides: Record<string, any> = {}) {
  const prisma: any = {
    targetCompetition: { findMany: jest.fn(async () => []) },
    event: { findMany: jest.fn(async () => []) },
    marketObservation: { findMany: jest.fn(async () => []) },
    ...overrides,
  };
  return { svc: new CandidatesService(prisma) as any, prisma };
}

describe('teamsWithUpcomingFixtures', () => {
  it('limits to target competitions once the list is seeded', async () => {
    const { svc, prisma } = service({
      targetCompetition: {
        findMany: jest.fn(async () => [{ externalId: '39' }, { externalId: 'unresolved:x' }]),
      },
      event: {
        findMany: jest.fn(async () => [
          { homeTeamId: 'a', awayTeamId: 'b' },
          { homeTeamId: 'a', awayTeamId: 'c' },
        ]),
      },
    });
    const teams = await svc.teamsWithUpcomingFixtures();
    expect(teams.map((t: any) => t.id).sort()).toEqual(['a', 'b', 'c']);
    expect(prisma.event.findMany.mock.calls[0][0].where.league).toEqual({
      externalId: { in: ['39'] },
    });
  });

  it('tests every fixture while no targets are seeded', async () => {
    const { svc, prisma } = service();
    await svc.teamsWithUpcomingFixtures();
    expect(prisma.event.findMany.mock.calls[0][0].where.league).toBeUndefined();
  });
});

describe('loadTeamSlices', () => {
  it('merges team and fixture rows, attributing fixture rows to the right venue', async () => {
    const base = { leagueId: 'L', season: 2025, dataQuality: 'OK', result: 'WIN' };
    const { svc } = service({
      event: {
        findMany: jest.fn(async () => [
          { id: 'e1', homeTeamId: 'T' },
          { id: 'e2', homeTeamId: 'X' },
        ]),
      },
      marketObservation: {
        findMany: jest
          .fn()
          // The team's own rows
          .mockResolvedValueOnce([
            { ...base, eventId: 'e1', marketDefinitionId: 'team-over', selection: 'HOME', isHome: true, kickoffAt: day(1) },
          ])
          // Fixture-level rows for its matches
          .mockResolvedValueOnce([
            { ...base, eventId: 'e1', marketDefinitionId: 'btts', selection: 'MATCH', isHome: null, kickoffAt: day(1) },
            { ...base, eventId: 'e2', marketDefinitionId: 'btts', selection: 'MATCH', isHome: null, kickoffAt: day(8), result: 'LOSS' },
          ]),
      },
    });

    const slices: Map<string, any[]> = await svc.loadTeamSlices('T');
    expect(slices.get('team-over')).toHaveLength(1);
    const btts = slices.get('btts')!;
    expect(btts.map((r) => r.isHome)).toEqual([true, false]);
    expect(btts.map((r) => r.result)).toEqual(['WIN', 'LOSS']);
  });

  it('returns nothing without querying observations when the team has no matches', async () => {
    const { svc, prisma } = service();
    const slices = await svc.loadTeamSlices('T');
    expect(slices.size).toBe(0);
    expect(prisma.marketObservation.findMany).not.toHaveBeenCalled();
  });
});
