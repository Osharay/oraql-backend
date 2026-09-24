-- The competitions we cover on purpose, rather than whatever has fixtures.
CREATE TABLE "target_competitions" (
    "id" TEXT NOT NULL,
    "externalId" TEXT,
    "name" TEXT NOT NULL,
    "country" TEXT,
    "tier" INTEGER NOT NULL DEFAULT 2,
    "seasons" INTEGER NOT NULL DEFAULT 4,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "resolvedAt" TIMESTAMP(3),
    "coveredAt" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "target_competitions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "target_competitions_externalId_key" ON "target_competitions"("externalId");
CREATE INDEX "target_competitions_isActive_tier_idx" ON "target_competitions"("isActive", "tier");
