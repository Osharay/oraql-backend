/**
 * The accuracy settings, in one place.
 *
 * Each has a default chosen from the first week of settled results and can be
 * changed with an environment variable, so a fix can be tuned — or switched
 * back to the old behaviour — without a code change. Read on every call, so a
 * changed variable applies from the next engine run.
 */

const num = (name: string, fallback: number): number => {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && process.env[name] !== '' && process.env[name] != null ? v : fallback;
};
const flag = (name: string, fallback: boolean): boolean => {
  const v = process.env[name];
  if (v == null || v === '') return fallback;
  return !['0', 'false', 'off', 'no'].includes(v.toLowerCase());
};

export function engineSettings() {
  return {
    // Fix 2 — honest chances
    honestChance: flag('ORAQL_HONEST_CHANCE', true),
    /** Matches' worth of the market's usual rate a record is pulled towards. */
    shrinkMatches: num('ORAQL_SHRINK_MATCHES', 12),
    chanceMax: num('ORAQL_CHANCE_MAX', 0.9),
    chanceMin: num('ORAQL_CHANCE_MIN', 0.05),

    // Fix 3 — recent form
    formHalfLife: num('ORAQL_FORM_HALF_LIFE', 20),
    /** The most recent form may move a chance from the season figure. */
    formMaxShift: num('ORAQL_FORM_MAX_SHIFT', 0.05),
    emergingMinMatches: num('ORAQL_EMERGING_MIN_MATCHES', 12),

    // Fix 1 — the record
    countOnce: flag('ORAQL_RESULTS_COUNT_ONCE', true),

    // Fix 4 — OraQL's clusters
    clusterBar: flag('ORAQL_CLUSTER_BAR', true),
    clusterMinLeg: num('ORAQL_CLUSTER_MIN_LEG', 0.6),
    clusterMinCombined: num('ORAQL_CLUSTER_MIN_COMBINED', 0.2),
    clusterSize: num('ORAQL_CLUSTER_SIZE', 3),

    // Fix 5 — contradictions
    hideContradictions: flag('ORAQL_HIDE_CONTRADICTIONS', true),

    // Fix 6 — leagues we cannot settle
    hideUnsettleable: flag('ORAQL_HIDE_UNSETTLEABLE', true),
    leagueMinSettled: num('ORAQL_LEAGUE_MIN_SETTLED', 0.8),
    leagueSettleDays: num('ORAQL_LEAGUE_SETTLE_DAYS', 30),
  };
}

export type EngineSettings = ReturnType<typeof engineSettings>;
