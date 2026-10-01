-- Fail fast rather than queue behind a busy table (see 20260928090000).
SET lock_timeout = '10s';

-- Where a market row came from. MODEL rows are the probability model's own and
-- are rebuilt on every recompute; STREAK rows are created when a streak or
-- cluster selection is added to a Bet Builder and must survive recomputes.
-- A constant default is a catalogue-only change on Postgres 11+.
ALTER TABLE "markets" ADD COLUMN "origin" TEXT NOT NULL DEFAULT 'MODEL';

RESET lock_timeout;
