-- Fail fast rather than queue behind a busy table (see 20260928090000).
SET lock_timeout = '10s';

-- How each OraQL pick settled. A copy of the pick as it stood at kickoff, so
-- the record survives picks being regenerated or markets being replaced.
CREATE TABLE "pick_results" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "marketName" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "probability" DOUBLE PRECISION NOT NULL,
    "kickoffAt" TIMESTAMP(3) NOT NULL,
    "result" "ObservationResult" NOT NULL,
    "settledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pick_results_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "pick_results_eventId_marketName_key" ON "pick_results"("eventId", "marketName");
CREATE INDEX "pick_results_kickoffAt_idx" ON "pick_results"("kickoffAt");

ALTER TABLE "pick_results" ADD CONSTRAINT "pick_results_eventId_fkey"
    FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

RESET lock_timeout;
