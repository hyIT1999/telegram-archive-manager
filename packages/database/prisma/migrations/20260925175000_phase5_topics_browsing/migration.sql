-- AlterTable
ALTER TABLE "channels" ADD COLUMN     "topics_refreshed_at" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "forum_topics" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "channel_id" UUID NOT NULL,
    "topic_id" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "icon_color" INTEGER,
    "is_closed" BOOLEAN NOT NULL DEFAULT false,
    "is_pinned" BOOLEAN NOT NULL DEFAULT false,
    "is_hidden" BOOLEAN NOT NULL DEFAULT false,
    "telegram_date" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "forum_topics_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "forum_topics_channel_id_topic_id_key" ON "forum_topics"("channel_id", "topic_id");

-- CreateIndex
CREATE INDEX "messages_type_telegram_date_telegram_message_id_idx" ON "messages"("type", "telegram_date" DESC, "telegram_message_id" DESC);

-- CreateIndex
CREATE INDEX "messages_channel_id_thread_id_telegram_date_telegram_messag_idx" ON "messages"("channel_id", "thread_id", "telegram_date", "telegram_message_id");

-- AddForeignKey
ALTER TABLE "forum_topics" ADD CONSTRAINT "forum_topics_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;
