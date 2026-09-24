-- Hand-written: extensions must exist before the trigram index and the text search configuration.
-- Both are trusted extensions, so the database owner (role tam) can create them.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

-- CreateEnum
CREATE TYPE "ChatType" AS ENUM ('CHANNEL', 'SUPERGROUP', 'GROUP');

-- CreateEnum
CREATE TYPE "MessageType" AS ENUM ('TEXT', 'PHOTO', 'VIDEO', 'DOCUMENT', 'AUDIO', 'VOICE', 'ANIMATION', 'VIDEO_NOTE', 'STICKER', 'POLL', 'WEBPAGE', 'SERVICE', 'OTHER');

-- CreateEnum
CREATE TYPE "MediaType" AS ENUM ('PHOTO', 'VIDEO', 'DOCUMENT', 'AUDIO', 'VOICE', 'ANIMATION', 'VIDEO_NOTE', 'STICKER');

-- CreateEnum
CREATE TYPE "DownloadStatus" AS ENUM ('PENDING', 'DOWNLOADING', 'DOWNLOADED', 'FAILED', 'SKIPPED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DownloadJobStatus" AS ENUM ('PENDING', 'ACTIVE', 'PAUSED', 'COMPLETED', 'FAILED', 'SKIPPED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('PENDING', 'RUNNING', 'PAUSED', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ImportJobType" AS ENUM ('IMPORT', 'SYNC');

-- CreateEnum
CREATE TYPE "ImportMode" AS ENUM ('ALL', 'FROM_DATE');

-- CreateEnum
CREATE TYPE "ImportJobPhase" AS ENUM ('HISTORY', 'MEDIA', 'DONE');

-- CreateEnum
CREATE TYPE "TelegramAuthState" AS ENUM ('LOGGED_OUT', 'CODE_SENT', 'PASSWORD_REQUIRED', 'READY');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "last_login_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "user_id" UUID NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "absolute_expires_at" TIMESTAMPTZ(3) NOT NULL,
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "user_agent" TEXT,
    "ip" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "telegram_accounts" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "account_key" TEXT NOT NULL DEFAULT 'default',
    "telegram_user_id" BIGINT,
    "username" TEXT,
    "display_name" TEXT,
    "phone_enc" BYTEA,
    "phone_masked" TEXT,
    "auth_state" "TelegramAuthState" NOT NULL DEFAULT 'LOGGED_OUT',
    "phone_code_hash_enc" BYTEA,
    "code_expires_at" TIMESTAMPTZ(3),
    "next_code_type" TEXT,
    "last_error" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "telegram_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "telegram_dialogs" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "telegram_chat_id" BIGINT NOT NULL,
    "title" TEXT NOT NULL,
    "username" TEXT,
    "type" "ChatType" NOT NULL,
    "access_hash" BIGINT,
    "is_forum" BOOLEAN NOT NULL DEFAULT false,
    "is_protected" BOOLEAN NOT NULL DEFAULT false,
    "member_count" INTEGER,
    "migrated_from_chat_id" BIGINT,
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "telegram_dialogs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "channels" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "telegram_chat_id" BIGINT NOT NULL,
    "title" TEXT NOT NULL,
    "username" TEXT,
    "type" "ChatType" NOT NULL,
    "access_hash" BIGINT,
    "is_forum" BOOLEAN NOT NULL DEFAULT false,
    "is_protected" BOOLEAN NOT NULL DEFAULT false,
    "member_count" INTEGER,
    "sync_enabled" BOOLEAN NOT NULL DEFAULT false,
    "head_message_id" INTEGER,
    "backfill_cursor_id" INTEGER,
    "backfill_complete" BOOLEAN NOT NULL DEFAULT false,
    "last_synced_at" TIMESTAMPTZ(3),
    "migrated_from_chat_id" BIGINT,
    "migrated_to_channel_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "channels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "channel_id" UUID NOT NULL,
    "telegram_message_id" INTEGER NOT NULL,
    "type" "MessageType" NOT NULL,
    "text" TEXT,
    "caption" TEXT,
    "entities" JSONB,
    "telegram_date" TIMESTAMPTZ(3) NOT NULL,
    "edit_date" TIMESTAMPTZ(3),
    "reply_to_message_id" INTEGER,
    "media_group_id" BIGINT,
    "thread_id" INTEGER,
    "forward_info" JSONB,
    "views" INTEGER,
    "telegram_meta" JSONB,
    "is_favorite" BOOLEAN NOT NULL DEFAULT false,
    "favorited_at" TIMESTAMPTZ(3),
    "search_vector" tsvector,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "media" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "message_id" UUID NOT NULL,
    "telegram_file_id" TEXT NOT NULL,
    "telegram_file_unique_id" TEXT NOT NULL,
    "type" "MediaType" NOT NULL,
    "filename" TEXT,
    "mime_type" TEXT,
    "size" BIGINT,
    "width" INTEGER,
    "height" INTEGER,
    "duration" DOUBLE PRECISION,
    "storage_key" TEXT,
    "thumbnail_key" TEXT,
    "download_status" "DownloadStatus" NOT NULL DEFAULT 'PENDING',
    "download_progress" INTEGER NOT NULL DEFAULT 0,
    "downloaded_bytes" BIGINT NOT NULL DEFAULT 0,
    "checksum" CHAR(64),
    "error" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "media_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tags" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "name" TEXT NOT NULL,
    "name_normalized" TEXT NOT NULL,
    "color" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_tags" (
    "message_id" UUID NOT NULL,
    "tag_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_tags_pkey" PRIMARY KEY ("message_id","tag_id")
);

-- CreateTable
CREATE TABLE "import_jobs" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "channel_id" UUID NOT NULL,
    "parent_import_job_id" UUID,
    "type" "ImportJobType" NOT NULL DEFAULT 'IMPORT',
    "mode" "ImportMode" NOT NULL DEFAULT 'ALL',
    "from_date" TIMESTAMPTZ(3),
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "phase" "ImportJobPhase" NOT NULL DEFAULT 'HISTORY',
    "run_seq" INTEGER NOT NULL DEFAULT 0,
    "bull_job_id" TEXT,
    "total_messages" INTEGER,
    "processed_messages" INTEGER NOT NULL DEFAULT 0,
    "total_media" INTEGER NOT NULL DEFAULT 0,
    "downloaded_files" INTEGER NOT NULL DEFAULT 0,
    "failed_files" INTEGER NOT NULL DEFAULT 0,
    "skipped_files" INTEGER NOT NULL DEFAULT 0,
    "total_bytes" BIGINT NOT NULL DEFAULT 0,
    "downloaded_bytes" BIGINT NOT NULL DEFAULT 0,
    "current_file" TEXT,
    "error" TEXT,
    "started_at" TIMESTAMPTZ(3),
    "messages_completed_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "import_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "download_jobs" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "media_id" UUID NOT NULL,
    "import_job_id" UUID,
    "status" "DownloadJobStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "download_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_settings_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions"("token_hash");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE INDEX "sessions_expires_at_idx" ON "sessions"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "telegram_accounts_account_key_key" ON "telegram_accounts"("account_key");

-- CreateIndex
CREATE UNIQUE INDEX "telegram_dialogs_telegram_chat_id_key" ON "telegram_dialogs"("telegram_chat_id");

-- CreateIndex
CREATE UNIQUE INDEX "channels_telegram_chat_id_key" ON "channels"("telegram_chat_id");

-- CreateIndex
CREATE INDEX "channels_migrated_to_channel_id_idx" ON "channels"("migrated_to_channel_id");

-- CreateIndex
CREATE INDEX "messages_channel_id_telegram_date_telegram_message_id_idx" ON "messages"("channel_id", "telegram_date" DESC, "telegram_message_id" DESC);

-- CreateIndex
CREATE INDEX "messages_telegram_date_telegram_message_id_idx" ON "messages"("telegram_date" DESC, "telegram_message_id" DESC);

-- CreateIndex
CREATE INDEX "messages_channel_id_media_group_id_idx" ON "messages"("channel_id", "media_group_id");

-- CreateIndex
CREATE INDEX "messages_favorites_idx" ON "messages"("favorited_at" DESC) WHERE (is_favorite);

-- CreateIndex
CREATE INDEX "messages_search_vector_idx" ON "messages" USING GIN ("search_vector");

-- CreateIndex
CREATE UNIQUE INDEX "messages_channel_id_telegram_message_id_key" ON "messages"("channel_id", "telegram_message_id");

-- CreateIndex
CREATE INDEX "media_telegram_file_unique_id_idx" ON "media"("telegram_file_unique_id");

-- CreateIndex
CREATE INDEX "media_checksum_idx" ON "media"("checksum");

-- CreateIndex
CREATE INDEX "media_download_status_type_idx" ON "media"("download_status", "type");

-- CreateIndex
CREATE INDEX "media_filename_trgm_idx" ON "media" USING GIN ("filename" gin_trgm_ops);

-- CreateIndex
CREATE UNIQUE INDEX "media_message_id_telegram_file_unique_id_key" ON "media"("message_id", "telegram_file_unique_id");

-- CreateIndex
CREATE UNIQUE INDEX "tags_name_normalized_key" ON "tags"("name_normalized");

-- CreateIndex
CREATE INDEX "message_tags_tag_id_idx" ON "message_tags"("tag_id");

-- CreateIndex
CREATE INDEX "import_jobs_channel_id_created_at_idx" ON "import_jobs"("channel_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "import_jobs_status_idx" ON "import_jobs"("status");

-- CreateIndex
CREATE INDEX "import_jobs_parent_import_job_id_idx" ON "import_jobs"("parent_import_job_id");

-- CreateIndex
CREATE UNIQUE INDEX "import_jobs_one_active_per_channel" ON "import_jobs"("channel_id") WHERE (status = ANY (ARRAY['PENDING'::"JobStatus", 'RUNNING'::"JobStatus", 'PAUSED'::"JobStatus"]));

-- CreateIndex
CREATE UNIQUE INDEX "download_jobs_media_id_key" ON "download_jobs"("media_id");

-- CreateIndex
CREATE INDEX "download_jobs_import_job_id_status_idx" ON "download_jobs"("import_job_id", "status");

-- CreateIndex
CREATE INDEX "download_jobs_status_idx" ON "download_jobs"("status");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channels" ADD CONSTRAINT "channels_migrated_to_channel_id_fkey" FOREIGN KEY ("migrated_to_channel_id") REFERENCES "channels"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media" ADD CONSTRAINT "media_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_tags" ADD CONSTRAINT "message_tags_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_tags" ADD CONSTRAINT "message_tags_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_parent_import_job_id_fkey" FOREIGN KEY ("parent_import_job_id") REFERENCES "import_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "download_jobs" ADD CONSTRAINT "download_jobs_media_id_fkey" FOREIGN KEY ("media_id") REFERENCES "media"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "download_jobs" ADD CONSTRAINT "download_jobs_import_job_id_fkey" FOREIGN KEY ("import_job_id") REFERENCES "import_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written: accent-insensitive full-text search (Prisma cannot express these objects,
-- and its migration differ ignores them, so they never cause drift).
-- ---------------------------------------------------------------------------

-- 'simple' parsing (no stemming — the archive is multilingual, mostly Vietnamese) plus unaccent,
-- so "hoc" matches "học" while ts_headline still highlights the original accented text.
CREATE TEXT SEARCH CONFIGURATION public.tam_simple (COPY = pg_catalog.simple);
ALTER TEXT SEARCH CONFIGURATION public.tam_simple
  ALTER MAPPING FOR word, hword, hword_part, numword, numhword, hword_numpart
  WITH public.unaccent, pg_catalog.simple;

-- search_vector = text (weight A) + caption (weight B), NFC-normalized so decomposed (NFD)
-- input from Telegram clients indexes the same as precomposed text.
CREATE FUNCTION public.messages_search_vector_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('public.tam_simple', normalize(coalesce(NEW.text, ''), NFC)), 'A') ||
    setweight(to_tsvector('public.tam_simple', normalize(coalesce(NEW.caption, ''), NFC)), 'B');
  RETURN NEW;
END
$$;

-- Only fires when text/caption change (not on favorite/view-count updates).
CREATE TRIGGER messages_search_vector_trg
  BEFORE INSERT OR UPDATE OF text, caption ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.messages_search_vector_update();
