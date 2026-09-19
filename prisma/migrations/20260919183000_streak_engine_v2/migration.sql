-- Streak Engine V2: append-only observations, baselines, candidates,
-- snapshots and settlement. Purely additive — no existing table is altered.

-- ─── Enums ───
CREATE TYPE "ObservationResult" AS ENUM ('WIN', 'LOSS', 'VOID', 'UNKNOWN');
CREATE TYPE "ObservationSelection" AS ENUM ('HOME', 'AWAY', 'MATCH');
CREATE TYPE "DataQuality" AS ENUM ('OK', 'PARTIAL', 'SUSPECT');
CREATE TYPE "StreakStatus" AS ENUM ('NEW', 'ACTIVE', 'STRENGTHENING', 'WEAKENING', 'BROKEN', 'EXPIRED', 'FILTERED');
CREATE TYPE "StreakEntityType" AS ENUM ('TEAM', 'LEAGUE', 'MATCHUP');
CREATE TYPE "ProfileFlag" AS ENUM ('WATCH', 'NEUTRAL', 'CAUTION');

-- ─── market_definitions ───
CREATE TABLE "market_definitions" (
    "id" TEXT NOT NULL,
    "marketId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "shortName" TEXT,
    "category" "MarketCategory" NOT NULL,
    "line" DOUBLE PRECISION,
    "selections" "ObservationSelection"[],
    "requires" TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "market_definitions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "market_definitions_marketId_key" ON "market_definitions"("marketId");
CREATE INDEX "market_definitions_isActive_idx" ON "market_definitions"("isActive");

-- ─── market_observations ───
CREATE TABLE "market_observations" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "marketDefinitionId" TEXT NOT NULL,
    "selection" "ObservationSelection" NOT NULL,
    "line" DOUBLE PRECISION,
    "result" "ObservationResult" NOT NULL,
    "leagueId" TEXT NOT NULL,
    "season" INTEGER NOT NULL,
    "teamId" TEXT,
    "isHome" BOOLEAN,
    "kickoffAt" TIMESTAMP(3) NOT NULL,
    "oddsAtSettlement" DOUBLE PRECISION,
    "impliedProbability" DOUBLE PRECISION,
    "dataQuality" "DataQuality" NOT NULL DEFAULT 'OK',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "settledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "market_observations_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "market_observations_eventId_marketDefinitionId_selection_rev_key"
    ON "market_observations"("eventId", "marketDefinitionId", "selection", "revision");
CREATE INDEX "market_observations_marketDefinitionId_leagueId_season_idx"
    ON "market_observations"("marketDefinitionId", "leagueId", "season");
CREATE INDEX "market_observations_teamId_marketDefinitionId_kickoffAt_idx"
    ON "market_observations"("teamId", "marketDefinitionId", "kickoffAt" DESC);
CREATE INDEX "market_observations_kickoffAt_idx" ON "market_observations"("kickoffAt");
CREATE INDEX "market_observations_result_idx" ON "market_observations"("result");

-- ─── market_baselines ───
CREATE TABLE "market_baselines" (
    "id" TEXT NOT NULL,
    "marketDefinitionId" TEXT NOT NULL,
    "leagueId" TEXT,
    "season" INTEGER,
    "sampleSize" INTEGER NOT NULL,
    "wins" INTEGER NOT NULL,
    "baselineRate" DOUBLE PRECISION NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "market_baselines_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "market_baselines_marketDefinitionId_leagueId_season_key"
    ON "market_baselines"("marketDefinitionId", "leagueId", "season");
CREATE INDEX "market_baselines_marketDefinitionId_idx" ON "market_baselines"("marketDefinitionId");

-- ─── engine_runs ───
CREATE TABLE "engine_runs" (
    "id" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "eventsScanned" INTEGER NOT NULL DEFAULT 0,
    "observationsCreated" INTEGER NOT NULL DEFAULT 0,
    "candidatesTested" INTEGER NOT NULL DEFAULT 0,
    "candidatesSurviving" INTEGER NOT NULL DEFAULT 0,
    "clustersCreated" INTEGER NOT NULL DEFAULT 0,
    "errors" TEXT,
    "warnings" TEXT,
    CONSTRAINT "engine_runs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "engine_runs_startedAt_idx" ON "engine_runs"("startedAt");

-- ─── streak_candidates ───
CREATE TABLE "streak_candidates" (
    "id" TEXT NOT NULL,
    "engineRunId" TEXT NOT NULL,
    "entityType" "StreakEntityType" NOT NULL,
    "entityId" TEXT NOT NULL,
    "marketDefinitionId" TEXT NOT NULL,
    "selection" "ObservationSelection" NOT NULL,
    "context" JSONB,
    "sampleSize" INTEGER NOT NULL,
    "wins" INTEGER NOT NULL,
    "hitRate" DOUBLE PRECISION NOT NULL,
    "baselineRate" DOUBLE PRECISION NOT NULL,
    "lift" DOUBLE PRECISION NOT NULL,
    "pValue" DOUBLE PRECISION,
    "adjustedPValue" DOUBLE PRECISION,
    "currentStreak" INTEGER NOT NULL DEFAULT 0,
    "longestStreak" INTEGER NOT NULL DEFAULT 0,
    "last10" TEXT,
    "strengthScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" "StreakStatus" NOT NULL DEFAULT 'NEW',
    "survivedGate" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "streak_candidates_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "streak_candidates_engineRunId_survivedGate_idx" ON "streak_candidates"("engineRunId", "survivedGate");
CREATE INDEX "streak_candidates_marketDefinitionId_lift_idx" ON "streak_candidates"("marketDefinitionId", "lift" DESC);
CREATE INDEX "streak_candidates_entityType_entityId_idx" ON "streak_candidates"("entityType", "entityId");

-- ─── streak_snapshots ───
CREATE TABLE "streak_snapshots" (
    "id" TEXT NOT NULL,
    "streakCandidateId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dataCutoffAt" TIMESTAMP(3) NOT NULL,
    "kickoffAt" TIMESTAMP(3) NOT NULL,
    "hitRate" DOUBLE PRECISION NOT NULL,
    "baselineRate" DOUBLE PRECISION NOT NULL,
    "lift" DOUBLE PRECISION NOT NULL,
    "sampleSize" INTEGER NOT NULL,
    "currentStreak" INTEGER NOT NULL,
    "strengthScore" DOUBLE PRECISION NOT NULL,
    "oddsAtCapture" DOUBLE PRECISION,
    "impliedProbability" DOUBLE PRECISION,
    "edge" DOUBLE PRECISION,
    "displayedRank" INTEGER,
    "wasDisplayed" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "streak_snapshots_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "streak_snapshots_eventId_idx" ON "streak_snapshots"("eventId");
CREATE INDEX "streak_snapshots_kickoffAt_idx" ON "streak_snapshots"("kickoffAt");
CREATE INDEX "streak_snapshots_wasDisplayed_kickoffAt_idx" ON "streak_snapshots"("wasDisplayed", "kickoffAt");

-- ─── snapshot_results ───
CREATE TABLE "snapshot_results" (
    "id" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "result" "ObservationResult" NOT NULL,
    "brokeStreakAtLength" INTEGER,
    "realisedLift" DOUBLE PRECISION,
    "failureNotes" TEXT,
    "settledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "snapshot_results_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "snapshot_results_snapshotId_key" ON "snapshot_results"("snapshotId");
CREATE INDEX "snapshot_results_result_settledAt_idx" ON "snapshot_results"("result", "settledAt");

-- ─── team_market_profiles ───
CREATE TABLE "team_market_profiles" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "marketDefinitionId" TEXT NOT NULL,
    "sampleSize" INTEGER NOT NULL,
    "wins" INTEGER NOT NULL,
    "hitRate" DOUBLE PRECISION NOT NULL,
    "baselineRate" DOUBLE PRECISION NOT NULL,
    "lift" DOUBLE PRECISION NOT NULL,
    "variance" DOUBLE PRECISION,
    "flag" "ProfileFlag" NOT NULL DEFAULT 'NEUTRAL',
    "lastComputedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "team_market_profiles_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "team_market_profiles_teamId_marketDefinitionId_key" ON "team_market_profiles"("teamId", "marketDefinitionId");
CREATE INDEX "team_market_profiles_flag_idx" ON "team_market_profiles"("flag");

-- ─── clusters ───
CREATE TABLE "clusters" (
    "id" TEXT NOT NULL,
    "engineRunId" TEXT,
    "date" TIMESTAMP(3) NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'DAILY_STRONGEST',
    "componentCount" INTEGER NOT NULL,
    "combinedProbability" DOUBLE PRECISION NOT NULL,
    "status" "StreakStatus" NOT NULL DEFAULT 'NEW',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "clusters_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "clusters_date_idx" ON "clusters"("date");

-- ─── cluster_components ───
CREATE TABLE "cluster_components" (
    "id" TEXT NOT NULL,
    "clusterId" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    CONSTRAINT "cluster_components_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "cluster_components_clusterId_snapshotId_key" ON "cluster_components"("clusterId", "snapshotId");

-- ─── Foreign keys ───
ALTER TABLE "market_observations" ADD CONSTRAINT "market_observations_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "market_observations" ADD CONSTRAINT "market_observations_marketDefinitionId_fkey" FOREIGN KEY ("marketDefinitionId") REFERENCES "market_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "market_observations" ADD CONSTRAINT "market_observations_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "leagues"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "market_observations" ADD CONSTRAINT "market_observations_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "market_baselines" ADD CONSTRAINT "market_baselines_marketDefinitionId_fkey" FOREIGN KEY ("marketDefinitionId") REFERENCES "market_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "market_baselines" ADD CONSTRAINT "market_baselines_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "leagues"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "streak_candidates" ADD CONSTRAINT "streak_candidates_engineRunId_fkey" FOREIGN KEY ("engineRunId") REFERENCES "engine_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "streak_candidates" ADD CONSTRAINT "streak_candidates_marketDefinitionId_fkey" FOREIGN KEY ("marketDefinitionId") REFERENCES "market_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "streak_snapshots" ADD CONSTRAINT "streak_snapshots_streakCandidateId_fkey" FOREIGN KEY ("streakCandidateId") REFERENCES "streak_candidates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "streak_snapshots" ADD CONSTRAINT "streak_snapshots_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "snapshot_results" ADD CONSTRAINT "snapshot_results_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "streak_snapshots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "team_market_profiles" ADD CONSTRAINT "team_market_profiles_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "team_market_profiles" ADD CONSTRAINT "team_market_profiles_marketDefinitionId_fkey" FOREIGN KEY ("marketDefinitionId") REFERENCES "market_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "clusters" ADD CONSTRAINT "clusters_engineRunId_fkey" FOREIGN KEY ("engineRunId") REFERENCES "engine_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "cluster_components" ADD CONSTRAINT "cluster_components_clusterId_fkey" FOREIGN KEY ("clusterId") REFERENCES "clusters"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "cluster_components" ADD CONSTRAINT "cluster_components_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "streak_snapshots"("id") ON DELETE CASCADE ON UPDATE CASCADE;
