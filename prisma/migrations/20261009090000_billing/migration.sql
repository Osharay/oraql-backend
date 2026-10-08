-- Fail fast rather than queue behind a busy table (see 20260928090000).
SET lock_timeout = '10s';

-- Trial and paid-period ends on each user. Nullable: no rewrite of the table.
ALTER TABLE "users" ADD COLUMN "trialEndsAt" TIMESTAMP(3), ADD COLUMN "subscriptionEndsAt" TIMESTAMP(3);

-- Everyone already signed up gets the trial from today, not from the day
-- they joined, so no one is locked out the moment the paywall ships.
UPDATE "users" SET "trialEndsAt" = CURRENT_TIMESTAMP + INTERVAL '2 days' WHERE "trialEndsAt" IS NULL;

CREATE TABLE "billing_settings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "monthlyPrice" INTEGER NOT NULL DEFAULT 5000,
    "quarterlyPrice" INTEGER NOT NULL DEFAULT 10000,
    "trialDays" INTEGER NOT NULL DEFAULT 2,
    "paywallEnabled" BOOLEAN NOT NULL DEFAULT true,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "billing_settings_pkey" PRIMARY KEY ("id")
);
INSERT INTO "billing_settings" ("id") VALUES ('default');

CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "plan" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "periodDays" INTEGER NOT NULL,
    "reference" TEXT NOT NULL,
    "providerRef" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "payments_reference_key" ON "payments"("reference");
CREATE INDEX "payments_userId_createdAt_idx" ON "payments"("userId", "createdAt");
CREATE INDEX "payments_status_createdAt_idx" ON "payments"("status", "createdAt");
ALTER TABLE "payments" ADD CONSTRAINT "payments_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

RESET lock_timeout;
