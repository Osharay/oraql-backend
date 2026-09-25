import { createHash } from 'crypto';

/**
 * What an event's observations were derived from.
 *
 * Deciding whether a finished match needs deriving again used to mean
 * counting its distinct observation pairs and looking for settleable
 * UNKNOWNs — a correlated subquery over market_observations for every match
 * in scope, on every batch. With close to a million rows that was the
 * slowest part of the pipeline.
 *
 * Instead, derivation stamps each event with the inputs it used: which
 * markets were live, and which of the match's inputs were present. An event
 * needs deriving again only when that stamp no longer matches — a market was
 * added, statistics or a half-time score arrived, a score was filled in.
 * Comparing the stamp reads the events table alone.
 *
 * The SQL twin of `deriveSignature` lives in ObservationsService; the two
 * must build the same string, which the spec checks.
 */

export interface SignatureInputs {
  registryHash: string;
  /** Statistics present for BOTH sides — what corner and card markets need. */
  hasStats: boolean;
  /** Both half-time goals known. */
  hasHalfTime: boolean;
  /** Both full-time goals known — without them nothing settles. */
  hasScore: boolean;
}

const flag = (b: boolean) => (b ? '1' : '0');

export function deriveSignature(i: SignatureInputs): string {
  return `${i.registryHash}:${flag(i.hasStats)}:${flag(i.hasHalfTime)}:${flag(i.hasScore)}`;
}

/**
 * A short, order-independent fingerprint of the live market registry: the
 * markets both the database has active and the code can evaluate.
 */
export function registryHash(marketIds: string[]): string {
  const sorted = [...new Set(marketIds)].sort();
  return createHash('sha1').update(sorted.join('|')).digest('hex').slice(0, 12);
}
