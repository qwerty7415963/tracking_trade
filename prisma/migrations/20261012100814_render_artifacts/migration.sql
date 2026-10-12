-- CreateTable
CREATE TABLE "render_artifacts" (
    "id" TEXT NOT NULL,
    "render_id" TEXT NOT NULL,
    "snapshot_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "position_id" TEXT NOT NULL,
    "execution_id" TEXT,
    "artifact_path" TEXT NOT NULL,
    "content_hash" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "mime_type" TEXT NOT NULL DEFAULT 'image/png',
    "template_version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "render_artifacts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "render_artifacts_render_id_key" ON "render_artifacts"("render_id");

-- CreateIndex
CREATE INDEX "render_artifacts_position_id_created_at_idx" ON "render_artifacts"("position_id", "created_at");
