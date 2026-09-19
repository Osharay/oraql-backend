-- Markets differ in base rate and volatility, so the evidence needed to
-- distinguish one from its baseline differs too. Null keeps the engine default.
ALTER TABLE "market_definitions" ADD COLUMN "minSample" INTEGER;
