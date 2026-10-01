-- CreateEnum
CREATE TYPE "BackupStatus" AS ENUM ('PENDING', 'ACTIVE', 'COMPLETED', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "BackupStage" AS ENUM ('FETCHING', 'UPLOADING', 'SENDING');

-- CreateEnum
CREATE TYPE "BackupSkipReason" AS ENUM ('NOT_AVAILABLE', 'PROTECTED', 'UNSUPPORTED', 'TOO_LARGE');

-- AlterTable
ALTER TABLE "channels" ADD COLUMN     "backup_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "backup_location_id" UUID,
ADD COLUMN     "backup_note" TEXT;

-- AlterTable
ALTER TABLE "telegram_dialogs" ADD COLUMN     "can_manage_topics" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "can_post" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "message_backups" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "message_id" UUID NOT NULL,
    "storage_location_id" UUID NOT NULL,
    "channel_id" UUID NOT NULL,
    "status" "BackupStatus" NOT NULL DEFAULT 'PENDING',
    "stage" "BackupStage",
    "skip_reason" "BackupSkipReason",
    "run_seq" INTEGER NOT NULL DEFAULT 0,
    "owner" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "not_before" TIMESTAMPTZ(3),
    "requested_at" TIMESTAMPTZ(3),
    "force" BOOLEAN NOT NULL DEFAULT false,
    "replace_previous" BOOLEAN NOT NULL DEFAULT false,
    "size" BIGINT,
    "uploaded_bytes" BIGINT NOT NULL DEFAULT 0,
    "random_id" BIGINT,
    "uploaded_media" JSONB,
    "sent_name" TEXT,
    "sent_size" BIGINT,
    "sent_sha256" CHAR(64),
    "sent_text_hash" CHAR(64),
    "backup_chat_id" BIGINT,
    "backup_message_id" INTEGER,
    "backup_thread_id" INTEGER,
    "backup_grouped_id" BIGINT,
    "extra_message_ids" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "replaced_message_ids" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "error" TEXT,
    "last_attempt_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "verified_at" TIMESTAMPTZ(3),
    "verify_error" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_backups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "backup_topics" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "storage_location_id" UUID NOT NULL,
    "channel_id" UUID NOT NULL,
    "source_topic_id" INTEGER NOT NULL,
    "backup_topic_id" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "backup_topics_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "message_backups_channel_id_status_idx" ON "message_backups"("channel_id", "status");

-- CreateIndex
CREATE INDEX "message_backups_storage_location_id_status_idx" ON "message_backups"("storage_location_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "message_backups_message_id_storage_location_id_key" ON "message_backups"("message_id", "storage_location_id");

-- CreateIndex
CREATE INDEX "backup_topics_channel_id_idx" ON "backup_topics"("channel_id");

-- CreateIndex
CREATE UNIQUE INDEX "backup_topics_storage_location_id_channel_id_source_topic_i_key" ON "backup_topics"("storage_location_id", "channel_id", "source_topic_id");

-- CreateIndex
CREATE INDEX "channels_backup_location_id_idx" ON "channels"("backup_location_id");

-- AddForeignKey
ALTER TABLE "channels" ADD CONSTRAINT "channels_backup_location_id_fkey" FOREIGN KEY ("backup_location_id") REFERENCES "storage_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_backups" ADD CONSTRAINT "message_backups_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_backups" ADD CONSTRAINT "message_backups_storage_location_id_fkey" FOREIGN KEY ("storage_location_id") REFERENCES "storage_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_backups" ADD CONSTRAINT "message_backups_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "backup_topics" ADD CONSTRAINT "backup_topics_storage_location_id_fkey" FOREIGN KEY ("storage_location_id") REFERENCES "storage_locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "backup_topics" ADD CONSTRAINT "backup_topics_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Hand-written: a Telegram backup chat receives copies of messages; it is never where downloads
-- go, so it can never be the default location (the api refuses it too).
ALTER TABLE "storage_locations" ADD CONSTRAINT "storage_locations_telegram_never_default"
  CHECK (kind <> 'TELEGRAM' OR NOT is_default);

-- Hand-written: live updates of the backup panel. Once per statement for bulk updates, for the
-- channel and for the supergroup an old basic group was upgraded to (like the downloads).
CREATE FUNCTION public.tam_notify_message_backups()
RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  target uuid;
BEGIN
  FOR target IN
    SELECT DISTINCT affected.id
    FROM changed_rows AS b
    JOIN public.channels AS c ON c.id = b.channel_id
    CROSS JOIN LATERAL (VALUES (c.id), (c.migrated_to_channel_id)) AS affected(id)
    WHERE affected.id IS NOT NULL
  LOOP
    PERFORM pg_notify('tam_changes', 'backups:' || target::text);
  END LOOP;
  RETURN NULL;
END;
$$;

-- Transition tables need one trigger per event.
CREATE TRIGGER message_backups_notify_insert
AFTER INSERT ON public.message_backups
REFERENCING NEW TABLE AS changed_rows
FOR EACH STATEMENT EXECUTE FUNCTION public.tam_notify_message_backups();

CREATE TRIGGER message_backups_notify_update
AFTER UPDATE ON public.message_backups
REFERENCING NEW TABLE AS changed_rows
FOR EACH STATEMENT EXECUTE FUNCTION public.tam_notify_message_backups();
