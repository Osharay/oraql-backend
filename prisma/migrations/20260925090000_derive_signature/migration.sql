-- Almost every observation is WIN or LOSS, so an index on result narrows
-- nothing, while every one of the ~80 rows a match produces has to update it.
DROP INDEX IF EXISTS "market_observations_result_idx";

-- What each event's observations were derived from (registry + inputs present).
-- An event is re-derived only when this no longer matches, instead of counting
-- its observation rows on every batch. NULL means never stamped: existing
-- events are re-checked once, which writes nothing new, then stamped.
ALTER TABLE "events" ADD COLUMN "derivedSignature" TEXT;
