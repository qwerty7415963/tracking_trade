-- Multi-entry (DCA) orders: every entry level with its frozen notional, and
-- the subset that has not filled yet. entry_price becomes the average of the
-- levels that actually filled.
ALTER TABLE "virtual_positions"
    ADD COLUMN "entries" JSONB NOT NULL DEFAULT '[]';

ALTER TABLE "virtual_positions"
    ADD COLUMN "pending_entries" JSONB NOT NULL DEFAULT '[]';
