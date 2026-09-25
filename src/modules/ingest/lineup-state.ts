import { LineupData } from './interfaces/data-provider.interface';

/**
 * Whether a fixture's lineups are in: both sides have named a starting XI.
 *
 * The provider sometimes publishes one team before the other, and before
 * kick-off an empty array means "not yet", so a single side or a short XI
 * does not count. Eleven is the rule; fewer means the data is incomplete.
 */
export function lineupsComplete(
  lineups: Pick<LineupData, 'teamExternalId' | 'starters'>[],
  homeExternalId: string,
  awayExternalId: string,
): boolean {
  const full = (teamId: string) =>
    lineups.some((l) => l.teamExternalId === teamId && l.starters.length >= 11);
  return full(homeExternalId) && full(awayExternalId);
}
