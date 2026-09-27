// Builds the database tam_perf: a synthetic archive about 40 times the size of a typical one,
// for scripts/perf/measure.mjs. Only neutral, made-up names; nothing comes from Telegram.
//   node scripts/perf/seed.mjs          (needs npm run build:packages and the root .env)
// Drop it afterwards: node scripts/perf/seed.mjs --drop
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrateDeploy, recreateDatabase, withDatabaseName } from '@tam/database';
import pg from 'pg';

export const PERF_DATABASE = 'tam_perf';

const root = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
process.loadEnvFile(path.join(root, '.env'));

export const perfDatabaseUrl = withDatabaseName(process.env.DATABASE_URL, PERF_DATABASE);

const WORDS = [
  'lesson',
  'chapter',
  'intro',
  'notes',
  'review',
  'exercise',
  'lecture',
  'part',
  'summary',
  'session',
  'module',
  'unit',
  'practice',
  'guide',
  'overview',
  'basics',
  'advanced',
  'project',
  'homework',
  'quiz',
];
const MORE_WORDS = [
  'bài',
  'giảng',
  'chương',
  'phần',
  'ôn',
  'tập',
  'buổi',
  'học',
  'đề',
  'thi',
  'lý',
  'thuyết',
];

/** How the synthetic archive is shaped. */
export const CHANNELS = [
  // A forum with 50 topics whose files mostly downloaded (an import job owns them).
  {
    key: 'forum',
    chatId: -1009000000001n,
    title: 'Perf forum',
    type: 'SUPERGROUP',
    isForum: true,
    downloadMedia: true,
    messages: 100_000,
  },
  // A channel with automatic downloads switched off: every file waits (PENDING).
  {
    key: 'off',
    chatId: -1009000000002n,
    title: 'Perf channel without downloads',
    type: 'CHANNEL',
    isForum: false,
    downloadMedia: false,
    messages: 40_000,
  },
  {
    key: 'small',
    chatId: -1009000000003n,
    title: 'Perf small channel',
    type: 'CHANNEL',
    isForum: false,
    downloadMedia: true,
    messages: 10_000,
  },
];

const sqlArray = (values) => `ARRAY[${values.map((value) => `'${value}'`).join(',')}]`;

async function seed(client) {
  const channelIds = {};
  for (const channel of CHANNELS) {
    const { rows } = await client.query(
      `INSERT INTO channels (telegram_chat_id, title, type, is_forum, download_media, head_message_id,
         backfill_complete, last_synced_at)
       VALUES ($1, $2, $3::"ChatType", $4, $5, $6, true, now()) RETURNING id`,
      [
        channel.chatId,
        channel.title,
        channel.type,
        channel.isForum,
        channel.downloadMedia,
        channel.messages,
      ],
    );
    channelIds[channel.key] = rows[0].id;
  }

  for (const channel of CHANNELS) {
    const started = Date.now();
    await client.query(
      `INSERT INTO messages (channel_id, telegram_message_id, type, text, caption, telegram_date,
         thread_id, is_favorite, favorited_at)
       SELECT $1::uuid, g,
         (ARRAY['TEXT','VIDEO','PHOTO','DOCUMENT','AUDIO']::"MessageType"[])[1 + g % 5],
         CASE WHEN g % 5 = 0 THEN
           (${sqlArray(WORDS)})[1 + g % 20] || ' ' || (${sqlArray(MORE_WORDS)})[1 + (g / 20) % 12] || ' ' || (g % 97)
         END,
         CASE WHEN g % 10 = 1 THEN (${sqlArray(MORE_WORDS)})[1 + g % 12] || ' ' || (${sqlArray(WORDS)})[1 + (g / 12) % 20] END,
         timestamptz '2019-01-01 00:00:00+00' + g * interval '13 minutes',
         CASE WHEN $3 AND g % 7 <> 0 THEN 2 + g % 50 END,
         g % 500 = 0,
         CASE WHEN g % 500 = 0 THEN timestamptz '2026-01-01 00:00:00+00' + g * interval '1 minute' END
       FROM generate_series(1, $2::int) AS g`,
      [channelIds[channel.key], channel.messages, channel.isForum],
    );
    console.log(`  ${channel.messages} messages in ${channel.title} (${Date.now() - started} ms)`);
  }

  const { rows: jobRows } = await client.query(
    `INSERT INTO import_jobs (channel_id, type, status, phase, processed_messages, total_messages,
       started_at, messages_completed_at, completed_at, created_at)
     VALUES ($1, 'IMPORT', 'COMPLETED', 'DONE', 100000, 100000, now() - interval '40 days',
       now() - interval '39 days', now() - interval '30 days', now() - interval '40 days')
     RETURNING id`,
    [channelIds.forum],
  );
  const importJobId = jobRows[0].id;

  // Download state by message id: the forum mostly downloaded, "off" all waiting, "small" done.
  const statusOf = (channel) =>
    channel.key === 'off'
      ? `'PENDING'`
      : channel.key === 'small'
        ? `'DOWNLOADED'`
        : `CASE WHEN m.telegram_message_id % 20 < 12 THEN 'DOWNLOADED'
                WHEN m.telegram_message_id % 20 < 18 THEN 'PENDING'
                WHEN m.telegram_message_id % 20 = 18 THEN 'FAILED' ELSE 'SKIPPED' END`;
  for (const channel of CHANNELS) {
    const started = Date.now();
    await client.query(
      `INSERT INTO media (message_id, telegram_file_id, telegram_file_unique_id, type, filename,
         mime_type, size, download_status, downloaded_bytes)
       SELECT m.id, $2 || ':' || m.telegram_message_id || ':u' || m.telegram_message_id,
         'u' || $2 || '-' || m.telegram_message_id,
         m.type::text::"MediaType",
         initcap((${sqlArray(WORDS)})[1 + m.telegram_message_id % 20]) || ' '
           || (${sqlArray(MORE_WORDS)})[1 + (m.telegram_message_id / 7) % 12] || ' '
           || lpad((m.telegram_message_id % 100)::text, 2, '0')
           || CASE m.type WHEN 'VIDEO' THEN '.mp4' WHEN 'PHOTO' THEN '.jpg' WHEN 'DOCUMENT' THEN '.pdf' ELSE '.mp3' END,
         CASE m.type WHEN 'VIDEO' THEN 'video/mp4' WHEN 'PHOTO' THEN 'image/jpeg'
           WHEN 'DOCUMENT' THEN 'application/pdf' ELSE 'audio/mpeg' END,
         50000 + (m.telegram_message_id::bigint * 7919) % 900000000,
         (${statusOf(channel)})::"DownloadStatus",
         0
       FROM messages m WHERE m.channel_id = $1 AND m.type <> 'TEXT'`,
      [channelIds[channel.key], String(channel.chatId)],
    );
    await client.query(
      `INSERT INTO download_jobs (media_id, import_job_id, status, attempts)
       SELECT d.id, $2::uuid,
         (CASE d.download_status WHEN 'DOWNLOADED' THEN 'COMPLETED' ELSE d.download_status::text END)::"DownloadJobStatus",
         CASE WHEN d.download_status = 'FAILED' THEN 8 ELSE 0 END
       FROM media d JOIN messages m ON m.id = d.message_id WHERE m.channel_id = $1`,
      [channelIds[channel.key], channel.key === 'forum' ? importJobId : null],
    );
    console.log(`  files and download jobs of ${channel.title} (${Date.now() - started} ms)`);
  }

  await client.query(
    `INSERT INTO import_jobs (channel_id, type, origin, status, phase, processed_messages,
       created_at, started_at, completed_at)
     SELECT ($1::uuid[])[1 + g % 3], 'SYNC', 'SCHEDULE', 'COMPLETED', 'DONE', g % 5,
       now() - g * interval '30 minutes', now() - g * interval '30 minutes',
       now() - g * interval '30 minutes' + interval '5 seconds'
     FROM generate_series(1, 2000) AS g`,
    [[channelIds.forum, channelIds.off, channelIds.small]],
  );
  await client.query(
    `INSERT INTO forum_topics (channel_id, topic_id, title)
     SELECT $1, 1 + g, 'Topic ' || g FROM generate_series(1, 50) AS g`,
    [channelIds.forum],
  );
  await client.query(
    `INSERT INTO tags (name, name_normalized, color)
     SELECT 'Tag ' || g, 'tag ' || g, NULL FROM generate_series(1, 50) AS g`,
  );
  await client.query(
    `INSERT INTO message_tags (message_id, tag_id)
     SELECT m.id, t.id
     FROM (SELECT id, row_number() OVER (ORDER BY id) AS n FROM messages
           WHERE telegram_message_id % 7 = 3 LIMIT 20000) AS m
     JOIN (SELECT id, row_number() OVER (ORDER BY name) - 1 AS k FROM tags) AS t ON t.k = m.n % 50`,
  );
  // The import job's counters, as the importer leaves them.
  await client.query(
    `UPDATE import_jobs j SET total_media = c.total, downloaded_files = c.done, failed_files = c.failed,
       skipped_files = c.skipped, total_bytes = c.bytes, downloaded_bytes = c.done_bytes
     FROM (SELECT count(*)::int AS total,
             count(*) FILTER (WHERE d.status = 'COMPLETED')::int AS done,
             count(*) FILTER (WHERE d.status = 'FAILED')::int AS failed,
             count(*) FILTER (WHERE d.status = 'SKIPPED')::int AS skipped,
             sum(m.size)::bigint AS bytes,
             coalesce(sum(m.size) FILTER (WHERE d.status = 'COMPLETED'), 0)::bigint AS done_bytes
           FROM download_jobs d JOIN media m ON m.id = d.media_id WHERE d.import_job_id = $1) AS c
     WHERE j.id = $1`,
    [importJobId],
  );
  await client.query('VACUUM ANALYZE');
  return { channelIds, importJobId };
}

async function main() {
  if (process.argv.includes('--drop')) {
    const client = new pg.Client({
      connectionString: withDatabaseName(perfDatabaseUrl, 'postgres'),
    });
    await client.connect();
    await client.query(`DROP DATABASE IF EXISTS ${PERF_DATABASE} WITH (FORCE)`);
    await client.end();
    console.log(`Dropped ${PERF_DATABASE}.`);
    return;
  }
  const started = Date.now();
  console.log(`Recreating ${PERF_DATABASE} and applying the migrations…`);
  await recreateDatabase(perfDatabaseUrl);
  await migrateDeploy(perfDatabaseUrl);
  const client = new pg.Client({ connectionString: perfDatabaseUrl });
  await client.connect();
  try {
    await seed(client);
    const { rows } = await client.query(
      `SELECT (SELECT count(*) FROM messages) AS messages, (SELECT count(*) FROM media) AS media,
         (SELECT count(*) FROM download_jobs) AS download_jobs, (SELECT count(*) FROM import_jobs) AS jobs,
         pg_size_pretty(pg_database_size(current_database())) AS size`,
    );
    console.log(`Done in ${Math.round((Date.now() - started) / 1000)} s:`, rows[0]);
  } finally {
    await client.end();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
