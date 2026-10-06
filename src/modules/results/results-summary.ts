/**
 * Hit rates for the Results page: how many landed, against how many OraQL
 * expected to. Void and unknown results are left out of both, so a postponed
 * corner market cannot drag a rate down or prop it up.
 */

export interface SettledItem {
  result: string; // WIN | LOSS | VOID | UNKNOWN
  /** OraQL's chance for it when it was picked, 0-1. */
  probability: number;
}

export interface HitRate {
  settled: number;
  won: number;
  /** won / settled, or null with nothing settled. */
  rate: number | null;
  /** The average chance OraQL gave them: what the rate "should" be. */
  expected: number | null;
}

export function hitRate(items: SettledItem[]): HitRate {
  const counted = items.filter((i) => i.result === 'WIN' || i.result === 'LOSS');
  const won = counted.filter((i) => i.result === 'WIN').length;
  const settled = counted.length;
  return {
    settled,
    won,
    rate: settled ? won / settled : null,
    expected: settled ? counted.reduce((n, i) => n + i.probability, 0) / settled : null,
  };
}

/** Hit rates split by a key (tier, scope, driver…), in first-seen order. */
export function hitRateBy<T extends SettledItem>(items: T[], key: (i: T) => string): Record<string, HitRate> {
  const groups = new Map<string, T[]>();
  for (const i of items) {
    const k = key(i);
    groups.set(k, [...(groups.get(k) ?? []), i]);
  }
  return Object.fromEntries([...groups].map(([k, v]) => [k, hitRate(v)]));
}

/** What drove a streak pick: its last few games, or its whole record. */
export function driverOf(context: unknown, hitRate: number): 'RECENT' | 'SEASON' {
  const c = (context ?? {}) as { emerging?: boolean; formRate?: number };
  if (c.emerging) return 'RECENT';
  if (typeof c.formRate === 'number' && c.formRate - hitRate >= 0.05) return 'RECENT';
  return 'SEASON';
}

/** A cluster lands only if every selection does; pending while any is unsettled. */
export function clusterOutcome(results: Array<string | null | undefined>): 'WIN' | 'LOSS' | 'PENDING' | 'VOID' {
  if (results.some((r) => r === 'LOSS')) return 'LOSS';
  if (results.some((r) => r == null || r === 'UNKNOWN')) return 'PENDING';
  if (results.every((r) => r === 'VOID')) return 'VOID';
  return 'WIN';
}

/** The first item for each key, in order: one row per bet, the earliest kept. */
export function firstOfEach<T>(items: T[], key: (i: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((i) => {
    const k = key(i);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * Whether a call counts on the record: it must have been made before the
 * match started. A call with no time on it cannot show that, so it does not.
 */
export function publishedBeforeKickoff(madeAt: Date | null | undefined, kickoffAt: Date): boolean {
  return madeAt != null && madeAt.getTime() < kickoffAt.getTime();
}
