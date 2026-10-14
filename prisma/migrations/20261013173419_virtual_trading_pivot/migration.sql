/*
  Warnings:

  - You are about to drop the column `execution_id` on the `render_artifacts` table. All the data in the column will be lost.
  - You are about to drop the column `execution_id` on the `telegram_publications` table. All the data in the column will be lost.
  - You are about to drop the `bridge_heartbeats` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `execution_commands` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `executions` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "execution_commands" DROP CONSTRAINT "execution_commands_signal_version_id_fkey";

-- DropForeignKey
ALTER TABLE "executions" DROP CONSTRAINT "executions_execution_command_id_fkey";

-- DropForeignKey
ALTER TABLE "telegram_publications" DROP CONSTRAINT "telegram_publications_execution_id_fkey";

-- AlterTable
ALTER TABLE "render_artifacts" DROP COLUMN "execution_id",
ADD COLUMN     "virtual_position_id" TEXT;

-- AlterTable
ALTER TABLE "telegram_publications" DROP COLUMN "execution_id",
ADD COLUMN     "virtual_position_id" TEXT;

-- DropTable
DROP TABLE "bridge_heartbeats";

-- DropTable
DROP TABLE "execution_commands";

-- DropTable
DROP TABLE "executions";

-- CreateTable
CREATE TABLE "virtual_accounts" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "balance" DECIMAL(30,8) NOT NULL,
    "leverage" INTEGER NOT NULL DEFAULT 10,
    "mode" TEXT NOT NULL DEFAULT 'APPROVE',
    "margin_type" TEXT NOT NULL DEFAULT 'CROSS',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "virtual_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "virtual_positions" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "signal_id" TEXT,
    "signal_version_id" TEXT,
    "coin" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "size" DECIMAL(30,8) NOT NULL,
    "entry_price" DECIMAL(30,8) NOT NULL,
    "stop_loss" DECIMAL(30,8),
    "take_profits" JSONB NOT NULL,
    "leverage" INTEGER NOT NULL,
    "remaining_size" DECIMAL(30,8) NOT NULL,
    "filled_tps" JSONB NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "opened_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMP(3),
    "close_price" DECIMAL(30,8),
    "realized_pnl" DECIMAL(30,8),

    CONSTRAINT "virtual_positions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "virtual_transactions" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amount" DECIMAL(30,8) NOT NULL,
    "reference" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "virtual_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "virtual_positions_account_id_status_idx" ON "virtual_positions"("account_id", "status");

-- CreateIndex
CREATE INDEX "virtual_transactions_account_id_created_at_idx" ON "virtual_transactions"("account_id", "created_at");

-- AddForeignKey
ALTER TABLE "virtual_positions" ADD CONSTRAINT "virtual_positions_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "virtual_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "virtual_positions" ADD CONSTRAINT "virtual_positions_signal_id_fkey" FOREIGN KEY ("signal_id") REFERENCES "signals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "virtual_positions" ADD CONSTRAINT "virtual_positions_signal_version_id_fkey" FOREIGN KEY ("signal_version_id") REFERENCES "signal_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "virtual_transactions" ADD CONSTRAINT "virtual_transactions_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "virtual_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "telegram_publications" ADD CONSTRAINT "telegram_publications_virtual_position_id_fkey" FOREIGN KEY ("virtual_position_id") REFERENCES "virtual_positions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "render_artifacts" ADD CONSTRAINT "render_artifacts_virtual_position_id_fkey" FOREIGN KEY ("virtual_position_id") REFERENCES "virtual_positions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
