/**
 * The rules for saving and reading a custom cluster, as pure functions so
 * they can be tested without a database.
 *
 * A saved cluster is a pre-match call the user makes from the Bet Builder, to
 * see how it would have gone without placing it. For that record to mean
 * anything it has to be made before any of its matches start, and it cannot
 * be edited afterwards: it is locked as saved.
 */

export const MIN_LEGS = 2;
export const MAX_LEGS = 20;

const OPEN = ['SCHEDULED', 'LINEUP_CONFIRMED'];

export interface SavableSelection {
  label: string;
  status: string;
  kickoffAt: Date;
}

/** Why the builder cannot be saved as a cluster right now, or null if it can. */
export function cannotSave(selections: SavableSelection[], now: Date): string | null {
  if (selections.length < MIN_LEGS) return `A cluster needs at least ${MIN_LEGS} selections in the Bet Builder.`;
  if (selections.length > MAX_LEGS) return `A cluster can hold up to ${MAX_LEGS} selections.`;
  const started = selections.filter((s) => !OPEN.includes(s.status) || s.kickoffAt.getTime() <= now.getTime());
  if (started.length)
    return `${started.map((s) => s.label).join(', ')} ${started.length === 1 ? 'has' : 'have'} already started or been called off. Remove ${started.length === 1 ? 'it' : 'them'} to save — a cluster is saved before its matches begin.`;
  return null;
}

/** A cluster can be deleted only until its first match starts. */
export function canDelete(firstKickoffAt: Date, now: Date): boolean {
  return firstKickoffAt.getTime() > now.getTime();
}

export type ClusterState = 'UPCOMING' | 'IN_PLAY' | 'SETTLED';

/**
 * Where a saved cluster stands. Settled once every selection has a result, or
 * as soon as one loses: it cannot land after that.
 */
export function clusterState(legs: Array<{ result: string | null; kickoffAt: Date }>, now: Date): ClusterState {
  if (legs.some((l) => l.result === 'LOSS')) return 'SETTLED';
  if (legs.every((l) => l.result != null)) return 'SETTLED';
  if (legs.every((l) => l.kickoffAt.getTime() > now.getTime())) return 'UPCOMING';
  return 'IN_PLAY';
}

/** How a selection got into the builder, in words. */
export function sourceLabel(source: string | null | undefined, origin: string): string {
  switch (source) {
    case 'STREAK_EVIDENCE':
      return 'Evidence-backed streak';
    case 'STREAK_EMERGING':
      return 'Emerging streak';
    case 'STREAK_EXPLORATORY':
      return 'Exploratory streak';
    case 'CLUSTER':
      return 'From an OraQL cluster';
    case 'MATCH_FORM':
      return 'Match page form';
    default:
      return origin === 'STREAK' ? 'Streak' : 'Match market';
  }
}
