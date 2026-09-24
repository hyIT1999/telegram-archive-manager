-- CreateEnum
CREATE TYPE "StorageKind" AS ENUM ('LOCAL', 'GOOGLE_DRIVE');

-- AlterTable
ALTER TABLE "channels" ADD COLUMN     "storage_folder" TEXT,
ADD COLUMN     "storage_location_id" UUID;

-- AlterTable
ALTER TABLE "media" ADD COLUMN     "storage_location_id" UUID;

-- CreateTable
CREATE TABLE "storage_locations" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "kind" "StorageKind" NOT NULL,
    "name" TEXT NOT NULL,
    "display_path" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "secret_enc" BYTEA,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "built_in" BOOLEAN NOT NULL DEFAULT false,
    "last_error" TEXT,
    "last_checked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "storage_locations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "storage_locations_kind_target_key" ON "storage_locations"("kind", "target");

-- CreateIndex
CREATE UNIQUE INDEX "storage_locations_one_default" ON "storage_locations"("is_default") WHERE (is_default);

-- CreateIndex
CREATE UNIQUE INDEX "storage_locations_one_built_in" ON "storage_locations"("built_in") WHERE (built_in);

-- CreateIndex
CREATE INDEX "channels_storage_location_id_idx" ON "channels"("storage_location_id");

-- CreateIndex
CREATE INDEX "media_storage_location_id_idx" ON "media"("storage_location_id");

-- AddForeignKey
ALTER TABLE "channels" ADD CONSTRAINT "channels_storage_location_id_fkey" FOREIGN KEY ("storage_location_id") REFERENCES "storage_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media" ADD CONSTRAINT "media_storage_location_id_fkey" FOREIGN KEY ("storage_location_id") REFERENCES "storage_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
