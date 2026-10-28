-- Pending-entry /pos orders can defer the card style dialog until after the
-- first fill; style_chosen=false means the operator has not picked yet and the
-- card falls back to pnl-strip when the 1-minute window expires.
ALTER TABLE "virtual_positions"
    ADD COLUMN "style_chosen" BOOLEAN NOT NULL DEFAULT true;
