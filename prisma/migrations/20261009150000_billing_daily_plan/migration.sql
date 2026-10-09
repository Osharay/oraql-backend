-- Fail fast rather than queue behind a busy table (see 20260928090000).
SET lock_timeout = '10s';

-- A one-day pass. A constant default is metadata-only in Postgres 11+, and the
-- table holds a single row.
ALTER TABLE "billing_settings" ADD COLUMN "dailyPrice" INTEGER NOT NULL DEFAULT 200;
