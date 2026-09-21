/**
 * Whether to write an observation, and at which revision.
 *
 * Readers count WIN/LOSS and ignore the revision number, so the only change
 * that can never double-count is replacing an UNKNOWN with a settled result.
 * A settled result is never revised here, and nothing is written when the
 * outcome is still unknowable.
 *
 * Returns the revision to write, or null to write nothing.
 */
export function nextRevision(
  prior: { result: string; revision: number } | undefined,
  result: string,
): number | null {
  if (!prior) return 1;
  if (prior.result !== 'UNKNOWN') return null;
  if (result === 'UNKNOWN') return null;
  return prior.revision + 1;
}
