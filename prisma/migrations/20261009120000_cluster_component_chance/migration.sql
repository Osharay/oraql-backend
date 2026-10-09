-- Fail fast rather than queue behind a busy table (see 20260928090000).
SET lock_timeout = '10s';

-- The chance each selection was built into a cluster with. Nullable: clusters
-- built before this keep showing the record they were built on.
ALTER TABLE "cluster_components" ADD COLUMN "chance" DOUBLE PRECISION;

RESET lock_timeout;
