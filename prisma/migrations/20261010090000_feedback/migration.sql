-- Fail fast rather than queue behind a busy table (see 20260928090000).
SET lock_timeout = '10s';

-- A new table: what people tell us from the feedback button.
CREATE TABLE "feedback" (
    "id" TEXT NOT NULL,
    "sentiment" TEXT NOT NULL,
    "message" TEXT,
    "email" TEXT,
    "userId" TEXT,
    "page" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feedback_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "feedback_createdAt_idx" ON "feedback"("createdAt");
