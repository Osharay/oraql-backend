-- Fail fast rather than queue behind a busy table (see 20260928090000).
SET lock_timeout = '10s';

-- Each player's season for his current club, so an absence can be weighed by
-- how much of the team's scoring he accounts for. Nullable: catalogue-only.
ALTER TABLE "players" ADD COLUMN "seasonGoals" INTEGER;
ALTER TABLE "players" ADD COLUMN "seasonAssists" INTEGER;
ALTER TABLE "players" ADD COLUMN "seasonApps" INTEGER;
ALTER TABLE "players" ADD COLUMN "seasonMinutes" INTEGER;
ALTER TABLE "players" ADD COLUMN "seasonShots" INTEGER;
ALTER TABLE "players" ADD COLUMN "statsSeason" INTEGER;
ALTER TABLE "players" ADD COLUMN "statsAt" TIMESTAMP(3);

-- When a club's squad numbers were last pulled, so they are refreshed every
-- few days rather than every run.
ALTER TABLE "teams" ADD COLUMN "playerStatsAt" TIMESTAMP(3);

-- When this fixture's injuries and suspensions were last checked.
ALTER TABLE "events" ADD COLUMN "absencesCheckedAt" TIMESTAMP(3);

RESET lock_timeout;
