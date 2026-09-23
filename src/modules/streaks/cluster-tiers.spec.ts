import { CLUSTER_TIERS, type ClusterType } from './cluster-tiers';

/**
 * The suggestive tier exists so a day with no findings is not an empty page.
 * Its whole safety rests on the reader being told which kind they are looking
 * at, so that is what is pinned here.
 */
describe('cluster tiers', () => {
  it('marks gated clusters as evidence-backed', () => {
    expect(CLUSTER_TIERS.DAILY_STRONGEST.tier).toBe('evidence');
  });

  it('never lets a suggestive cluster claim evidence', () => {
    expect(CLUSTER_TIERS.DAILY_SUGGESTIVE.tier).toBe('suggestive');
    expect(CLUSTER_TIERS.DAILY_SUGGESTIVE.label).not.toMatch(/evidence/i);
  });

  it('says in the caveat that a suggestive cluster did not clear the gate', () => {
    expect(CLUSTER_TIERS.DAILY_SUGGESTIVE.caveat).toMatch(/did NOT clear/);
    expect(CLUSTER_TIERS.DAILY_SUGGESTIVE.caveat).not.toMatch(/proven/i);
    expect(CLUSTER_TIERS.DAILY_SUGGESTIVE.caveat).toMatch(/luck/i);
  });

  it('describes every type the builder can write', () => {
    const written: ClusterType[] = ['DAILY_STRONGEST', 'DAILY_SUGGESTIVE'];
    for (const type of written) expect(CLUSTER_TIERS[type]).toBeDefined();
  });

  it('orders evidence before suggestive by type name, as the query relies on', () => {
    expect(['DAILY_SUGGESTIVE', 'DAILY_STRONGEST'].sort()[0]).toBe('DAILY_STRONGEST');
  });
});
