-- CreateEnum
CREATE TYPE "DownloadSkipReason" AS ENUM ('POLICY', 'NOT_AVAILABLE', 'PROTECTED');

-- CreateEnum
CREATE TYPE "DownloadStage" AS ENUM ('FETCHING', 'VERIFYING', 'STORING');

-- DropIndex
DROP INDEX "download_jobs_status_idx";

-- DropIndex
DROP INDEX "media_storage_location_id_idx";

-- AlterTable
ALTER TABLE "channels" ADD COLUMN     "download_media" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "download_note" TEXT;

-- Channels archived before downloads existed start with automatic downloads off, so upgrading
-- never starts downloading a whole archive on its own (new channels keep the default: on).
UPDATE "channels" SET "download_media" = false;

-- AlterTable
ALTER TABLE "download_jobs" ADD COLUMN     "not_before" TIMESTAMPTZ(3),
ADD COLUMN     "reason" "DownloadSkipReason",
ADD COLUMN     "requested_at" TIMESTAMPTZ(3),
ADD COLUMN     "run_seq" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "stage" "DownloadStage";

-- AlterTable
ALTER TABLE "media" ADD COLUMN     "thumbnail_checked_at" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "storage_locations" ADD COLUMN     "unavailable_until" TIMESTAMPTZ(3);

-- CreateIndex
CREATE INDEX "download_jobs_status_not_before_idx" ON "download_jobs"("status", "not_before");

-- CreateIndex
CREATE INDEX "media_thumbnail_pending_idx" ON "media"("id") WHERE (thumbnail_checked_at IS NULL);

-- CreateIndex
CREATE UNIQUE INDEX "media_storage_location_id_storage_key_key" ON "media"("storage_location_id", "storage_key");

