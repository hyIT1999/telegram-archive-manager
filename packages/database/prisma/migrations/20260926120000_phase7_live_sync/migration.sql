-- CreateEnum
CREATE TYPE "JobOrigin" AS ENUM ('MANUAL', 'SCHEDULE', 'TELEGRAM_UPDATE');

-- AlterTable
ALTER TABLE "channels" ADD COLUMN     "sync_note" TEXT,
ALTER COLUMN "sync_enabled" SET DEFAULT true;

-- AlterTable
ALTER TABLE "import_jobs" DROP COLUMN "current_file",
ADD COLUMN     "origin" "JobOrigin" NOT NULL DEFAULT 'MANUAL';

-- Hand-written from here on.

-- Automatic sync is on by default, for the channels already in the archive too. Protected chats
-- never sync, and the old basic group of an upgraded supergroup is frozen.
UPDATE public.channels
SET sync_enabled = true
WHERE NOT is_protected AND migrated_to_channel_id IS NULL;

-- Change notifications for live progress. A committed change of an import job, a channel or a
-- download sends a short payload on the channel 'tam_changes' ("job:<id>", "channel:<id>",
-- "downloads:<channel id>"); the api listens and relays events to browsers over SSE. PostgreSQL
-- sends notifications at commit only (rolled-back work stays silent) and delivers a payload
-- repeated within one transaction once. Prisma cannot express triggers and its migration differ
-- ignores them.

CREATE FUNCTION public.tam_notify_import_job()
RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('tam_changes', 'job:' || NEW.id::text);
  RETURN NULL;
END;
$$;

CREATE TRIGGER import_jobs_notify_insert
AFTER INSERT ON public.import_jobs
FOR EACH ROW EXECUTE FUNCTION public.tam_notify_import_job();

-- Media counters are recomputed with every download change; an unchanged row says nothing.
CREATE TRIGGER import_jobs_notify_update
AFTER UPDATE ON public.import_jobs
FOR EACH ROW WHEN (OLD.* IS DISTINCT FROM NEW.*)
EXECUTE FUNCTION public.tam_notify_import_job();

CREATE FUNCTION public.tam_notify_channel()
RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('tam_changes', 'channel:' || NEW.id::text);
  RETURN NULL;
END;
$$;

CREATE TRIGGER channels_notify_update
AFTER UPDATE ON public.channels
FOR EACH ROW WHEN (OLD.* IS DISTINCT FROM NEW.*)
EXECUTE FUNCTION public.tam_notify_channel();

-- Downloads change one row at a time (progress, results) or thousands at once (settings, retries,
-- cancels): per statement, one notification for each channel and each import job it touched. A
-- supergroup's downloads include its old basic group, so a change there is announced for both.
CREATE FUNCTION public.tam_notify_download_jobs()
RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  target uuid;
BEGIN
  FOR target IN
    SELECT DISTINCT affected.id
    FROM changed_rows AS d
    JOIN public.media AS m ON m.id = d.media_id
    JOIN public.messages AS g ON g.id = m.message_id
    JOIN public.channels AS c ON c.id = g.channel_id
    CROSS JOIN LATERAL (VALUES (c.id), (c.migrated_to_channel_id)) AS affected(id)
    WHERE affected.id IS NOT NULL
  LOOP
    PERFORM pg_notify('tam_changes', 'downloads:' || target::text);
  END LOOP;
  FOR target IN
    SELECT DISTINCT d.import_job_id FROM changed_rows AS d WHERE d.import_job_id IS NOT NULL
  LOOP
    PERFORM pg_notify('tam_changes', 'job:' || target::text);
  END LOOP;
  RETURN NULL;
END;
$$;

-- Transition tables need one trigger per event.
CREATE TRIGGER download_jobs_notify_insert
AFTER INSERT ON public.download_jobs
REFERENCING NEW TABLE AS changed_rows
FOR EACH STATEMENT EXECUTE FUNCTION public.tam_notify_download_jobs();

CREATE TRIGGER download_jobs_notify_update
AFTER UPDATE ON public.download_jobs
REFERENCING NEW TABLE AS changed_rows
FOR EACH STATEMENT EXECUTE FUNCTION public.tam_notify_download_jobs();
