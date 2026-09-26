-- Hand-written: file names join the full-text search document of their message. Prisma cannot
-- express functions and triggers, and its migration differ ignores them, so they never drift.

-- The search document of a message: its text (weight A), its caption (B) and the names of its
-- files (A). Dots and underscores in file names become spaces, so "Wave_Zone.mp4" is found by
-- "wave", "zone" and "mp4". Everything is NFC-normalized, like text and caption before.
CREATE FUNCTION public.messages_search_document(p_message_id uuid, p_text text, p_caption text)
RETURNS tsvector
LANGUAGE sql STABLE AS $$
  SELECT
    setweight(to_tsvector('public.tam_simple', normalize(coalesce(p_text, ''), NFC)), 'A') ||
    setweight(to_tsvector('public.tam_simple', normalize(coalesce(p_caption, ''), NFC)), 'B') ||
    setweight(
      to_tsvector(
        'public.tam_simple',
        normalize(
          coalesce(
            (SELECT string_agg(regexp_replace(media.filename, '[._]+', ' ', 'g'), ' ')
               FROM public.media
              WHERE media.message_id = p_message_id),
            ''
          ),
          NFC
        )
      ),
      'A'
    )
$$;

-- New or edited text and captions: the trigger stays the same, its function now adds file names.
CREATE OR REPLACE FUNCTION public.messages_search_vector_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.search_vector := public.messages_search_document(NEW.id, NEW.text, NEW.caption);
  RETURN NEW;
END
$$;

-- Files are stored after their message (in the same import transaction), so a new or renamed file
-- refreshes its message's document. The UPDATE sets search_vector only: the text/caption trigger
-- does not fire again, and updated_at stays as it was.
CREATE FUNCTION public.media_search_vector_refresh() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public.messages
     SET search_vector = public.messages_search_document(id, text, caption)
   WHERE id = NEW.message_id;
  RETURN NULL;
END
$$;

CREATE TRIGGER media_search_vector_trg
  AFTER INSERT OR UPDATE OF filename ON public.media
  FOR EACH ROW EXECUTE FUNCTION public.media_search_vector_refresh();

-- Messages archived before this change.
UPDATE public.messages AS message
   SET search_vector = public.messages_search_document(message.id, message.text, message.caption)
 WHERE EXISTS (SELECT 1 FROM public.media WHERE media.message_id = message.id);
