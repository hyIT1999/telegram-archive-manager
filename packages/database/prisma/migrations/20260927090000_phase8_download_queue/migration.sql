-- AlterTable
ALTER TABLE "download_jobs" ADD COLUMN     "channel_id" UUID,
ADD COLUMN     "size" BIGINT;

-- CreateIndex
CREATE INDEX "download_jobs_channel_id_status_size_idx" ON "download_jobs"("channel_id", "status", "size");

-- CreateIndex
CREATE INDEX "download_jobs_queue_idx" ON "download_jobs"("requested_at", "size", "id") WHERE (status = 'PENDING'::"DownloadJobStatus");

-- Hand-written: download_jobs.channel_id and .size copy the file's channel and size, so the
-- download queue and the per-channel counts read one table instead of joining media and messages
-- (measured on 120 000 files: the queue went from ~340 ms per pick). Triggers fill them for every
-- writer (importer, api, raw SQL); a file never changes channel, and its size is copied again
-- if it is ever corrected.

CREATE FUNCTION public.tam_download_job_defaults()
RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  SELECT g.channel_id, m.size INTO NEW.channel_id, NEW.size
  FROM public.media AS m
  JOIN public.messages AS g ON g.id = m.message_id
  WHERE m.id = NEW.media_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER download_jobs_defaults
BEFORE INSERT ON public.download_jobs
FOR EACH ROW EXECUTE FUNCTION public.tam_download_job_defaults();

CREATE FUNCTION public.tam_media_size_to_download_job()
RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public.download_jobs SET size = NEW.size WHERE media_id = NEW.id;
  RETURN NULL;
END;
$$;

CREATE TRIGGER media_size_to_download_job
AFTER UPDATE OF size ON public.media
FOR EACH ROW WHEN (OLD.size IS DISTINCT FROM NEW.size)
EXECUTE FUNCTION public.tam_media_size_to_download_job();

UPDATE public.download_jobs AS d
SET channel_id = g.channel_id, size = m.size
FROM public.media AS m
JOIN public.messages AS g ON g.id = m.message_id
WHERE m.id = d.media_id;

-- The change notifications of Phase 7 read the channel from the row itself now.
CREATE OR REPLACE FUNCTION public.tam_notify_download_jobs()
RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  target uuid;
BEGIN
  FOR target IN
    SELECT DISTINCT affected.id
    FROM changed_rows AS d
    JOIN public.channels AS c ON c.id = d.channel_id
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
