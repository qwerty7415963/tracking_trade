-- Position sizing is a fixed USDC notional per coin.
ALTER TABLE "tradable_coins"
    ADD COLUMN "notional_usd" DECIMAL(30, 8) NOT NULL DEFAULT 50000;

-- BTC/ETH/SOL start at 100k; every other coin keeps the 50k default.
UPDATE "tradable_coins"
   SET "notional_usd" = 100000
 WHERE "symbol" IN ('BTC', 'ETH', 'SOL');
