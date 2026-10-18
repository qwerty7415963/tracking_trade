-- AlterTable: per-position card style shown on every published card
-- ("pnl-strip" = floating-PnL strip, "position-stats" = Vietnamese
-- position-statistics card chosen by the operator after /pos).
ALTER TABLE "virtual_positions" ADD COLUMN "card_kind" TEXT NOT NULL DEFAULT 'pnl-strip';
