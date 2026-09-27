-- Fail fast instead of queueing behind a long-running query: a migration
-- waiting on a lock blocks every query behind it, which is what took the API
-- down on 25 September. If this times out, the deploy fails and the running
-- version keeps serving; redeploy once the database is quiet.
SET lock_timeout = '10s';

-- Team ratings (Elo), rebuilt from results by RatingsService. All nullable,
-- so these are catalogue-only changes: no table rewrite.
ALTER TABLE "teams" ADD COLUMN "rating" DOUBLE PRECISION;
ALTER TABLE "teams" ADD COLUMN "ratingMatches" INTEGER;
ALTER TABLE "teams" ADD COLUMN "ratingTier" TEXT;
ALTER TABLE "teams" ADD COLUMN "ratingLeagueId" TEXT;
ALTER TABLE "teams" ADD COLUMN "ratedAt" TIMESTAMP(3);

-- Each side's rating going into a match, so a record can later be split by
-- how strong the opponent was at the time.
ALTER TABLE "events" ADD COLUMN "homeRatingBefore" DOUBLE PRECISION;
ALTER TABLE "events" ADD COLUMN "awayRatingBefore" DOUBLE PRECISION;

RESET lock_timeout;
