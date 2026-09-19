-- A venue-agnostic slice ("this team, any venue") has no fixed selection:
-- the side is resolved per fixture when a snapshot is captured.
ALTER TABLE "streak_candidates" ALTER COLUMN "selection" DROP NOT NULL;
