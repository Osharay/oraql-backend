-- Fail fast rather than queue behind a busy table (see 20260928090000).
SET lock_timeout = '10s';

-- Where a Bet Builder selection came from, and for a streak its market and
-- side. Nullable, so existing selections are untouched.
ALTER TABLE "builder_selections"
    ADD COLUMN "source" TEXT,
    ADD COLUMN "streakMarketId" TEXT,
    ADD COLUMN "streakSide" TEXT;

-- Clusters users save from the Bet Builder, and their selections.
CREATE TABLE "custom_clusters" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT,
    "legCount" INTEGER NOT NULL,
    "combinedProbability" DOUBLE PRECISION,
    "combinedLow" DOUBLE PRECISION NOT NULL,
    "combinedHigh" DOUBLE PRECISION NOT NULL,
    "firstKickoffAt" TIMESTAMP(3) NOT NULL,
    "lastKickoffAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "custom_clusters_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "custom_cluster_legs" (
    "id" TEXT NOT NULL,
    "clusterId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "marketName" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "source" TEXT,
    "streakMarketId" TEXT,
    "streakSide" TEXT,
    "probability" DOUBLE PRECISION NOT NULL,
    "kickoffAt" TIMESTAMP(3) NOT NULL,
    "result" "ObservationResult",
    "settledAt" TIMESTAMP(3),

    CONSTRAINT "custom_cluster_legs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "custom_clusters_userId_createdAt_idx" ON "custom_clusters"("userId", "createdAt");
CREATE INDEX "custom_cluster_legs_clusterId_idx" ON "custom_cluster_legs"("clusterId");
CREATE INDEX "custom_cluster_legs_eventId_idx" ON "custom_cluster_legs"("eventId");
CREATE INDEX "custom_cluster_legs_result_kickoffAt_idx" ON "custom_cluster_legs"("result", "kickoffAt");

ALTER TABLE "custom_clusters" ADD CONSTRAINT "custom_clusters_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "custom_cluster_legs" ADD CONSTRAINT "custom_cluster_legs_clusterId_fkey"
    FOREIGN KEY ("clusterId") REFERENCES "custom_clusters"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "custom_cluster_legs" ADD CONSTRAINT "custom_cluster_legs_eventId_fkey"
    FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

RESET lock_timeout;
