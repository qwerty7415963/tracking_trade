-- Change the default card style for NEW positions only.
-- Existing rows keep whatever they already store (pnl-strip or position-stats).
ALTER TABLE "virtual_positions" ALTER COLUMN "card_kind" SET DEFAULT 'position-stats';
