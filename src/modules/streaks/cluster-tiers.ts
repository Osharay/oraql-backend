/**
 * What a cluster's type means to the person reading it.
 *
 * Two tiers, kept apart everywhere: evidence-backed clusters are built from
 * slices that cleared the significance gate after correcting for how many
 * were tested; suggestive ones are built from slices that did not. The second
 * tier exists so a day with no findings is not a blank page — but a reader who
 * cannot tell them apart is worse off than one shown nothing, so the label and
 * the caveat travel with the cluster from here.
 *
 * Pure and dependency-free so it can be tested without the database.
 */
export type ClusterType = 'DAILY_STRONGEST' | 'DAILY_SUGGESTIVE';

export interface ClusterTier {
  tier: 'evidence' | 'suggestive';
  label: string;
  caveat: string;
}

export const CLUSTER_TIERS: Record<ClusterType, ClusterTier> = {
  DAILY_STRONGEST: {
    tier: 'evidence',
    label: 'Evidence-backed',
    caveat:
      'Every component cleared the significance gate after correcting for how many slices were tested.',
  },
  DAILY_SUGGESTIVE: {
    tier: 'suggestive',
    label: 'Suggestive',
    caveat:
      'Strong recent form that did NOT clear the significance gate. Runs like these happen by luck often enough that they are leads to check, not findings.',
  },
};

export const tierOf = (type: string): ClusterTier =>
  CLUSTER_TIERS[type as ClusterType] ?? CLUSTER_TIERS.DAILY_STRONGEST;
