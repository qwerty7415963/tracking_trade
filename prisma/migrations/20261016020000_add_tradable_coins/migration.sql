-- CreateTable
CREATE TABLE "tradable_coins" (
    "id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tradable_coins_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tradable_coins_symbol_key" ON "tradable_coins"("symbol");

-- Seed operator-managed coin list (system seed, editable via API/bot)
INSERT INTO "tradable_coins" ("id", "symbol", "enabled", "notes", "created_by", "updated_at") VALUES
    ('11111111-1111-4111-8111-111111111111', 'BTC', true, 'seed', 'system', CURRENT_TIMESTAMP),
    ('22222222-2222-4222-8222-222222222222', 'ETH', true, 'seed', 'system', CURRENT_TIMESTAMP),
    ('33333333-3333-4333-8333-333333333333', 'SOL', true, 'seed', 'system', CURRENT_TIMESTAMP),
    ('44444444-4444-4444-8444-444444444444', 'XRP', true, 'seed', 'system', CURRENT_TIMESTAMP),
    ('55555555-5555-4555-8555-555555555555', 'DOGE', true, 'seed', 'system', CURRENT_TIMESTAMP),
    ('66666666-6666-4666-8666-666666666666', 'XAU', true, 'seed', 'system', CURRENT_TIMESTAMP),
    ('77777777-7777-4777-8777-777777777777', 'XAG', true, 'seed', 'system', CURRENT_TIMESTAMP),
    ('88888888-8888-4888-8888-888888888888', 'PAXG', true, 'seed', 'system', CURRENT_TIMESTAMP);
