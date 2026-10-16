-- CreateTable
CREATE TABLE "system_settings" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "system_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "system_settings_key_key" ON "system_settings"("key");

-- Seed: global open mode defaults to MANUAL (fail-safe, every post waits)
INSERT INTO "system_settings" ("id", "key", "value", "updated_by", "updated_at") VALUES
    ('99999999-9999-4999-8999-999999999999', 'open_mode', 'MANUAL', 'system', CURRENT_TIMESTAMP);
