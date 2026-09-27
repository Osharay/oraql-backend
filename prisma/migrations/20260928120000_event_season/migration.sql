-- Fail fast rather than queue behind a busy table (see 20260928090000).
SET lock_timeout = '10s';

-- The season a match belongs to. Observations took it from the league row,
-- which stores one season forever (the first fixture seen), so every match a
-- league ever had carried the same season. Nullable: catalogue-only change.
ALTER TABLE "events" ADD COLUMN "season" INTEGER;

RESET lock_timeout;
