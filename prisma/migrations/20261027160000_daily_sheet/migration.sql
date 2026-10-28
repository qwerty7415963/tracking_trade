-- Daily trading report sheet: positions need the first actual fill date, and
-- the sheet keeps its own first-run start date across restarts.
ALTER TABLE "virtual_positions"
    ADD COLUMN "filled_at" TIMESTAMP(3),
    ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE TABLE "daily_sheet_settings" (
    "id" TEXT NOT NULL,
    "start_date" DATE NOT NULL,
    "last_sync_at" TIMESTAMP(3),
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_sheet_settings_pkey" PRIMARY KEY ("id")
);
