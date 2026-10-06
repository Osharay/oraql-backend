/**
 * What makes two streak snapshots the same bet.
 *
 * The engine runs every day and each run writes fresh candidate rows, so the
 * same streak for the same match can be captured once per run. A fixture-level
 * market (a draw, both teams to score) can also arrive from either team. All of
 * those are one bet to the person reading the card — and must be counted once
 * on the record, or one result would be claimed three times.
 *
 * A fixture-level market is keyed by the match and the market; a team market
 * by the match, the market and the team (its home, away or overall evidence
 * slices are reasons for the same bet, not separate bets).
 */
export function betKey(s: {
  eventId: string;
  marketDefinitionId: string;
  selection: string | null;
  entityId: string;
}): string {
  return s.selection === 'MATCH'
    ? `${s.eventId}|${s.marketDefinitionId}`
    : `${s.eventId}|${s.marketDefinitionId}|${s.entityId}`;
}
