-- CreateEnum
CREATE TYPE "AuthProvider" AS ENUM ('EMAIL', 'GOOGLE', 'APPLE');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('USER', 'PREMIUM', 'ADMIN');

-- CreateEnum
CREATE TYPE "Sport" AS ENUM ('FOOTBALL', 'BASKETBALL', 'TENNIS', 'CRICKET', 'BASEBALL', 'HOCKEY');

-- CreateEnum
CREATE TYPE "EventStatus" AS ENUM ('SCHEDULED', 'LINEUP_CONFIRMED', 'LIVE', 'HALF_TIME', 'FINISHED', 'POSTPONED', 'CANCELLED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "MarketCategory" AS ENUM ('MATCH_RESULT', 'GOALS', 'CORNERS', 'CARDS', 'PLAYER', 'HALFTIME', 'HANDICAP', 'SPECIAL');

-- CreateEnum
CREATE TYPE "IngestJobStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'PARTIAL');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT,
    "firstName" TEXT,
    "lastName" TEXT,
    "avatarUrl" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'USER',
    "authProvider" "AuthProvider" NOT NULL DEFAULT 'EMAIL',
    "providerId" TEXT,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "preferredSports" "Sport"[] DEFAULT ARRAY['FOOTBALL']::"Sport"[],
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "refreshToken" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_activity_logs" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_activity_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leagues" (
    "id" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "country" TEXT,
    "countryCode" TEXT,
    "sport" "Sport" NOT NULL DEFAULT 'FOOTBALL',
    "season" INTEGER NOT NULL,
    "logoUrl" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leagues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teams" (
    "id" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "shortName" TEXT,
    "logoUrl" TEXT,
    "country" TEXT,
    "sport" "Sport" NOT NULL DEFAULT 'FOOTBALL',
    "venueCity" TEXT,
    "venueName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "teams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "players" (
    "id" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" TEXT,
    "number" INTEGER,
    "photoUrl" TEXT,
    "teamId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "players_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "events" (
    "id" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "homeTeamId" TEXT NOT NULL,
    "awayTeamId" TEXT NOT NULL,
    "sport" "Sport" NOT NULL DEFAULT 'FOOTBALL',
    "status" "EventStatus" NOT NULL DEFAULT 'SCHEDULED',
    "kickoffAt" TIMESTAMP(3) NOT NULL,
    "venue" TEXT,
    "round" TEXT,
    "homeScore" INTEGER,
    "awayScore" INTEGER,
    "htHomeScore" INTEGER,
    "htAwayScore" INTEGER,
    "ftHomeScore" INTEGER,
    "ftAwayScore" INTEGER,
    "lineupsConfirmedAt" TIMESTAMP(3),
    "lastDataSync" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "match_stats" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "goals" INTEGER NOT NULL DEFAULT 0,
    "shotsTotal" INTEGER,
    "shotsOnTarget" INTEGER,
    "possession" DOUBLE PRECISION,
    "corners" INTEGER NOT NULL DEFAULT 0,
    "yellowCards" INTEGER NOT NULL DEFAULT 0,
    "redCards" INTEGER NOT NULL DEFAULT 0,
    "fouls" INTEGER,
    "offsides" INTEGER,
    "saves" INTEGER,
    "expectedGoals" DOUBLE PRECISION,
    "passAccuracy" DOUBLE PRECISION,
    "totalPasses" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "match_stats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lineups" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "formation" TEXT,
    "isConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lineups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lineup_entries" (
    "id" TEXT NOT NULL,
    "lineupId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "position" TEXT,
    "gridPosition" TEXT,
    "isStarter" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "lineup_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "player_injuries" (
    "id" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "reason" TEXT,
    "status" TEXT NOT NULL,
    "startDate" TIMESTAMP(3),
    "expectedReturn" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "player_injuries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "markets" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "category" "MarketCategory" NOT NULL,
    "name" TEXT NOT NULL,
    "shortName" TEXT,
    "line" DOUBLE PRECISION,
    "probability" DOUBLE PRECISION NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "probabilityUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "impliedProbability" DOUBLE PRECISION,
    "valueGap" DOUBLE PRECISION,
    "isValueBet" BOOLEAN NOT NULL DEFAULT false,
    "explanation" TEXT,
    "explanationFactors" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "markets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "picks" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "marketId" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "probability" DOUBLE PRECISION NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "explanation" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "picks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bookmaker_odds" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "bookmaker" TEXT NOT NULL,
    "marketName" TEXT NOT NULL,
    "selection" TEXT NOT NULL,
    "odds" DOUBLE PRECISION NOT NULL,
    "impliedProb" DOUBLE PRECISION NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bookmaker_odds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "builder_selections" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "marketId" TEXT NOT NULL,
    "addedProbability" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "builder_selections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ingest_jobs" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "jobType" TEXT NOT NULL,
    "status" "IngestJobStatus" NOT NULL DEFAULT 'QUEUED',
    "recordsProcessed" INTEGER NOT NULL DEFAULT 0,
    "recordsFailed" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "metadata" JSONB,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ingest_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_email_idx" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_authProvider_providerId_idx" ON "users"("authProvider", "providerId");

-- CreateIndex
CREATE INDEX "user_activity_logs_userId_createdAt_idx" ON "user_activity_logs"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "leagues_externalId_key" ON "leagues"("externalId");

-- CreateIndex
CREATE INDEX "leagues_sport_isActive_idx" ON "leagues"("sport", "isActive");

-- CreateIndex
CREATE INDEX "leagues_externalId_idx" ON "leagues"("externalId");

-- CreateIndex
CREATE UNIQUE INDEX "teams_externalId_key" ON "teams"("externalId");

-- CreateIndex
CREATE INDEX "teams_externalId_idx" ON "teams"("externalId");

-- CreateIndex
CREATE INDEX "teams_sport_idx" ON "teams"("sport");

-- CreateIndex
CREATE UNIQUE INDEX "players_externalId_key" ON "players"("externalId");

-- CreateIndex
CREATE INDEX "players_teamId_idx" ON "players"("teamId");

-- CreateIndex
CREATE INDEX "players_externalId_idx" ON "players"("externalId");

-- CreateIndex
CREATE UNIQUE INDEX "events_externalId_key" ON "events"("externalId");

-- CreateIndex
CREATE INDEX "events_kickoffAt_idx" ON "events"("kickoffAt");

-- CreateIndex
CREATE INDEX "events_sport_kickoffAt_idx" ON "events"("sport", "kickoffAt");

-- CreateIndex
CREATE INDEX "events_status_kickoffAt_idx" ON "events"("status", "kickoffAt");

-- CreateIndex
CREATE INDEX "events_leagueId_kickoffAt_idx" ON "events"("leagueId", "kickoffAt");

-- CreateIndex
CREATE INDEX "events_homeTeamId_idx" ON "events"("homeTeamId");

-- CreateIndex
CREATE INDEX "events_awayTeamId_idx" ON "events"("awayTeamId");

-- CreateIndex
CREATE INDEX "events_externalId_idx" ON "events"("externalId");

-- CreateIndex
CREATE INDEX "match_stats_teamId_createdAt_idx" ON "match_stats"("teamId", "createdAt");

-- CreateIndex
CREATE INDEX "match_stats_eventId_idx" ON "match_stats"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "match_stats_eventId_teamId_key" ON "match_stats"("eventId", "teamId");

-- CreateIndex
CREATE UNIQUE INDEX "lineups_eventId_teamId_key" ON "lineups"("eventId", "teamId");

-- CreateIndex
CREATE UNIQUE INDEX "lineup_entries_lineupId_playerId_key" ON "lineup_entries"("lineupId", "playerId");

-- CreateIndex
CREATE INDEX "player_injuries_playerId_idx" ON "player_injuries"("playerId");

-- CreateIndex
CREATE INDEX "markets_eventId_category_idx" ON "markets"("eventId", "category");

-- CreateIndex
CREATE INDEX "markets_eventId_probability_idx" ON "markets"("eventId", "probability" DESC);

-- CreateIndex
CREATE INDEX "markets_isValueBet_idx" ON "markets"("isValueBet");

-- CreateIndex
CREATE INDEX "picks_eventId_isActive_idx" ON "picks"("eventId", "isActive");

-- CreateIndex
CREATE INDEX "picks_probability_idx" ON "picks"("probability" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "picks_eventId_rank_key" ON "picks"("eventId", "rank");

-- CreateIndex
CREATE INDEX "bookmaker_odds_eventId_marketName_idx" ON "bookmaker_odds"("eventId", "marketName");

-- CreateIndex
CREATE INDEX "bookmaker_odds_eventId_bookmaker_idx" ON "bookmaker_odds"("eventId", "bookmaker");

-- CreateIndex
CREATE INDEX "builder_selections_userId_idx" ON "builder_selections"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "builder_selections_userId_marketId_key" ON "builder_selections"("userId", "marketId");

-- CreateIndex
CREATE INDEX "ingest_jobs_provider_jobType_createdAt_idx" ON "ingest_jobs"("provider", "jobType", "createdAt");

-- CreateIndex
CREATE INDEX "ingest_jobs_status_idx" ON "ingest_jobs"("status");

-- AddForeignKey
ALTER TABLE "user_activity_logs" ADD CONSTRAINT "user_activity_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "players" ADD CONSTRAINT "players_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "leagues"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_homeTeamId_fkey" FOREIGN KEY ("homeTeamId") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_awayTeamId_fkey" FOREIGN KEY ("awayTeamId") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_stats" ADD CONSTRAINT "match_stats_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_stats" ADD CONSTRAINT "match_stats_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lineups" ADD CONSTRAINT "lineups_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lineup_entries" ADD CONSTRAINT "lineup_entries_lineupId_fkey" FOREIGN KEY ("lineupId") REFERENCES "lineups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lineup_entries" ADD CONSTRAINT "lineup_entries_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "players"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "player_injuries" ADD CONSTRAINT "player_injuries_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "players"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "markets" ADD CONSTRAINT "markets_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "picks" ADD CONSTRAINT "picks_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "picks" ADD CONSTRAINT "picks_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "markets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookmaker_odds" ADD CONSTRAINT "bookmaker_odds_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "builder_selections" ADD CONSTRAINT "builder_selections_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "builder_selections" ADD CONSTRAINT "builder_selections_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "markets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
