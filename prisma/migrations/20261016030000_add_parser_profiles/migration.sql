-- CreateTable
CREATE TABLE "parser_profiles" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "coin_aliases" JSONB,
    "notes" TEXT,
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "parser_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "parser_profiles_name_key" ON "parser_profiles"("name");
