/*
  Warnings:

  - You are about to drop the column `position_id` on the `render_artifacts` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "render_artifacts_position_id_created_at_idx";

-- AlterTable
ALTER TABLE "render_artifacts" DROP COLUMN "position_id";

-- CreateIndex
CREATE INDEX "render_artifacts_virtual_position_id_created_at_idx" ON "render_artifacts"("virtual_position_id", "created_at");
