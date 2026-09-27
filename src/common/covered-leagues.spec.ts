import { coveredIds, coveredLeagueFilter, resetCoveredLeagueCache } from './covered-leagues';

describe('covered leagues', () => {
  beforeEach(() => resetCoveredLeagueCache());

  it('drops unresolved and empty ids and de-duplicates', () => {
    expect(
      coveredIds([
        { externalId: '39' },
        { externalId: 'unresolved:Second League|Egypt' },
        { externalId: null },
        { externalId: '39' },
        { externalId: '140' },
      ]),
    ).toEqual(['39', '140']);
  });

  it('filters by provider id once the list is seeded', async () => {
    const prisma = { targetCompetition: { findMany: jest.fn().mockResolvedValue([{ externalId: '39' }]) } };
    await expect(coveredLeagueFilter(prisma as never)).resolves.toEqual({ externalId: { in: ['39'] } });
  });

  it('shows everything before the list is seeded', async () => {
    const prisma = { targetCompetition: { findMany: jest.fn().mockResolvedValue([]) } };
    await expect(coveredLeagueFilter(prisma as never)).resolves.toBeUndefined();
  });

  it('reads the list at most once a minute', async () => {
    const findMany = jest.fn().mockResolvedValue([{ externalId: '39' }]);
    const prisma = { targetCompetition: { findMany } };
    await coveredLeagueFilter(prisma as never);
    await coveredLeagueFilter(prisma as never);
    expect(findMany).toHaveBeenCalledTimes(1);
  });
});
