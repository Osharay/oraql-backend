-- Fail fast rather than queue behind a busy table (see 20260928090000).
SET lock_timeout = '10s';

-- When each settled pick was made, so the record counts only picks that were
-- published before kickoff.
ALTER TABLE "pick_results" ADD COLUMN "pickedAt" TIMESTAMP(3);

-- Fill it for picks already settled, from the pick as it still stands.
UPDATE "pick_results" pr
   SET "pickedAt" = p."computedAt"
  FROM "picks" p
  JOIN "markets" m ON m."id" = p."marketId"
 WHERE p."eventId" = pr."eventId"
   AND m."name" = pr."marketName";

RESET lock_timeout;
