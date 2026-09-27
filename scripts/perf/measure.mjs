// Times the api's main reads and the worker's recurring statements on tam_perf
// (scripts/perf/seed.mjs), and prints a table. Needs a fresh build: npm run build.
//   node scripts/perf/measure.mjs [--plans]
// --plans also prints the query plans of the worker statements.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { perfDatabaseUrl } from './seed.mjs';

const root = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const PORT = 3191;
const BASE = `http://127.0.0.1:${PORT}`;
const RUNS = 15;
const EMAIL = 'perf@example.test';
const PASSWORD = 'a passphrase only for this measurement';
const showPlans = process.argv.includes('--plans');

const cursor = (values) => Buffer.from(JSON.stringify(values)).toString('base64url');
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function redisUrl() {
  const url = new URL(process.env.REDIS_URL);
  url.pathname = '/12';
  return url.toString();
}

async function startApi() {
  const child = spawn(process.execPath, ['apps/api/dist/main.js'], {
    cwd: root,
    env: {
      ...process.env,
      NODE_ENV: 'development',
      LOG_LEVEL: 'warn',
      DATABASE_URL: perfDatabaseUrl,
      REDIS_URL: redisUrl(),
      BULLMQ_PREFIX: 'tamperf',
      API_HOST: '127.0.0.1',
      API_PORT: String(PORT),
      CSRF_TRUSTED_ORIGINS: BASE,
      WEB_DIST_DIR: '',
    },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      if ((await fetch(`${BASE}/api/health/live`)).ok) {
        return child;
      }
    } catch {
      // Not listening yet.
    }
    await pause(500);
  }
  child.kill();
  throw new Error('The api did not start');
}

function percentile(sorted, fraction) {
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}

async function main() {
  const { hashPassword } = await import(
    new URL('../../apps/api/dist/auth/password.js', import.meta.url).href
  );
  const db = new pg.Client({ connectionString: perfDatabaseUrl });
  await db.connect();
  await db.query(
    `INSERT INTO users (email, password_hash) VALUES ($1, $2)
     ON CONFLICT (email) DO UPDATE SET password_hash = excluded.password_hash`,
    [EMAIL, await hashPassword(PASSWORD)],
  );
  const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
  const forum = await one(`SELECT id FROM channels WHERE title = 'Perf forum'`);
  const tag = await one(`SELECT id FROM tags ORDER BY name LIMIT 1`);
  const job = await one(`SELECT id FROM import_jobs WHERE type = 'IMPORT' LIMIT 1`);
  const deepAll = await one(
    `SELECT telegram_date, telegram_message_id, id FROM messages WHERE type <> 'SERVICE'
     ORDER BY telegram_date DESC, telegram_message_id DESC, id DESC OFFSET 75000 LIMIT 1`,
  );
  const deepForum = await one(
    `SELECT telegram_date, telegram_message_id, id FROM messages WHERE channel_id = $1 AND type <> 'SERVICE'
     ORDER BY telegram_date DESC, telegram_message_id DESC, id DESC OFFSET 60000 LIMIT 1`,
    [forum.id],
  );
  const deepVideos = await one(
    `SELECT telegram_date, telegram_message_id, id FROM messages WHERE type = 'VIDEO'
     ORDER BY telegram_date DESC, telegram_message_id DESC, id DESC OFFSET 20000 LIMIT 1`,
  );
  const deepJobs = await one(
    `SELECT created_at, id FROM import_jobs ORDER BY created_at DESC, id DESC OFFSET 1500 LIMIT 1`,
  );
  const messageCursor = (row) =>
    cursor(['n', row.telegram_date.toISOString(), row.telegram_message_id, row.id]);

  const api = await startApi();
  const results = [];
  try {
    const login = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
    });
    if (!login.ok) {
      throw new Error(`login failed: ${login.status}`);
    }
    const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0];
    const get = (url) => fetch(`${BASE}${url}`, { headers: { Cookie: cookie } });

    const endpoints = [
      ['Dashboard totals', '/api/stats'],
      ['Channel list', '/api/channels'],
      ['Channel page (forum)', `/api/channels/${forum.id}`],
      ['Downloads panel (forum)', `/api/channels/${forum.id}/downloads`],
      ['Topics (forum)', `/api/channels/${forum.id}/topics`],
      ['All messages, first page', '/api/messages?limit=50'],
      ['All messages, page 1 500', `/api/messages?limit=50&cursor=${messageCursor(deepAll)}`],
      ['Channel, first page', `/api/messages?channelId=${forum.id}&limit=50`],
      [
        'Channel, page 1 200',
        `/api/messages?channelId=${forum.id}&limit=50&cursor=${messageCursor(deepForum)}`,
      ],
      ['Topic', `/api/messages?channelId=${forum.id}&topicId=7&limit=50`],
      ['Videos, first page', '/api/messages?types=VIDEO&limit=50'],
      [
        'Videos, page 400',
        `/api/messages?types=VIDEO&limit=50&cursor=${messageCursor(deepVideos)}`,
      ],
      ['Downloaded files', '/api/messages?downloaded=true&limit=50'],
      ['Tag filter', `/api/messages?tagIds=${tag.id}&limit=50`],
      ['Favorites', '/api/messages?favorite=true&sort=favorited&limit=50'],
      ['Search "lesson"', '/api/search?q=lesson&limit=20'],
      ['Search "bai giang 12"', `/api/search?q=${encodeURIComponent('bai giang 12')}&limit=20`],
      ['Import jobs, first page', '/api/import-jobs?limit=20'],
      [
        'Import jobs, page 75',
        `/api/import-jobs?limit=20&cursor=${cursor([deepJobs.created_at.toISOString(), deepJobs.id])}`,
      ],
      ['Tags', '/api/tags'],
    ];
    for (const [label, url] of endpoints) {
      for (let warm = 0; warm < 2; warm += 1) {
        await (await get(url)).arrayBuffer();
      }
      const samples = [];
      for (let run = 0; run < RUNS; run += 1) {
        const started = performance.now();
        const response = await get(url);
        await response.arrayBuffer();
        if (!response.ok) {
          throw new Error(`${label}: ${response.status}`);
        }
        samples.push(performance.now() - started);
      }
      samples.sort((a, b) => a - b);
      results.push({
        label,
        kind: 'HTTP',
        p50: percentile(samples, 0.5),
        p95: percentile(samples, 0.95),
      });
    }
  } finally {
    api.kill();
  }

  // The worker's statements that run again and again, rolled back after each measurement.
  const finished = await one(
    `SELECT id FROM download_jobs WHERE import_job_id = $1 AND status = 'PENDING' LIMIT 1`,
    [job.id],
  );
  const statements = [
    [
      'A file of a 100 000-file import ends (countFinishedFile)',
      // Same statement as countFinishedFile() (packages/database/src/media-counters.ts).
      `UPDATE import_jobs AS j
       SET downloaded_files = j.downloaded_files + ('COMPLETED' = 'COMPLETED')::int,
           failed_files = j.failed_files + ('COMPLETED' = 'FAILED')::int,
           skipped_files = j.skipped_files + ('COMPLETED' = 'SKIPPED')::int,
           downloaded_bytes = j.downloaded_bytes + coalesce(d.size, 0)
       FROM download_jobs AS d
       WHERE j.id = '${job.id}'::uuid AND d.id = '${finished.id}'::uuid`,
    ],
    [
      'Recount of a 100 000-file import (per import page)',
      `UPDATE import_jobs AS j
       SET total_media = c.total, downloaded_files = c.downloaded, failed_files = c.failed,
           skipped_files = c.skipped, total_bytes = c.total_bytes, downloaded_bytes = c.downloaded_bytes
       FROM (
         SELECT count(*)::int AS total,
                count(*) FILTER (WHERE d.status = 'COMPLETED')::int AS downloaded,
                count(*) FILTER (WHERE d.status = 'FAILED')::int AS failed,
                count(*) FILTER (WHERE d.status = 'SKIPPED')::int AS skipped,
                coalesce(sum(m.size), 0)::bigint AS total_bytes,
                coalesce(sum(m.size) FILTER (WHERE d.status = 'COMPLETED'), 0)::bigint AS downloaded_bytes
         FROM download_jobs d JOIN media m ON m.id = d.media_id
         WHERE d.import_job_id = '${job.id}'::uuid
       ) AS c
       WHERE j.id = '${job.id}'::uuid`,
    ],
    [
      'Download claim (every few seconds)',
      // Same statement as DownloadStore.claim() (apps/worker/src/media/download-store.ts),
      // with 3 free slots.
      `WITH picked AS (
         SELECT d.id
         FROM download_jobs d
         JOIN channels c ON c.id = d.channel_id
         LEFT JOIN storage_locations l ON l.id = coalesce(
           c.storage_location_id, (SELECT s.id FROM storage_locations s WHERE s.is_default)
         )
         WHERE d.status = 'PENDING'
           AND (d.not_before IS NULL OR d.not_before <= now())
           AND (d.requested_at IS NOT NULL OR c.download_media)
           AND (l.unavailable_until IS NULL OR l.unavailable_until <= now())
           AND NOT EXISTS (
             SELECT 1 FROM app_settings s WHERE s.key = 'downloads' AND s.value -> 'paused' = 'true'::jsonb
           )
         ORDER BY d.requested_at ASC NULLS LAST, d.size ASC NULLS LAST, d.id
         LIMIT 3
         FOR UPDATE OF d SKIP LOCKED
       )
       UPDATE download_jobs d
       SET status = 'ACTIVE', run_seq = d.run_seq + 1, stage = NULL, updated_at = now()
       FROM picked WHERE d.id = picked.id
       RETURNING d.id`,
    ],
  ];
  for (const [label, sql] of statements) {
    const samples = [];
    for (let run = 0; run < 7; run += 1) {
      await db.query('BEGIN');
      const { rows } = await db.query(`EXPLAIN (ANALYZE, FORMAT JSON) ${sql}`);
      await db.query('ROLLBACK');
      const plan = rows[0]['QUERY PLAN'][0];
      samples.push(plan['Execution Time']);
      if (showPlans && run === 0) {
        await db.query('BEGIN');
        const text = await db.query(`EXPLAIN (ANALYZE, BUFFERS) ${sql}`);
        await db.query('ROLLBACK');
        console.log(`\n--- ${label}\n${text.rows.map((row) => row['QUERY PLAN']).join('\n')}`);
      }
    }
    samples.sort((a, b) => a - b);
    results.push({
      label,
      kind: 'SQL',
      p50: percentile(samples, 0.5),
      p95: percentile(samples, 0.95),
    });
  }
  await db.query(`DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email = $1)`, [
    EMAIL,
  ]);
  await db.end();

  console.log(`\n| Measured on tam_perf (${RUNS} runs) | | p50 ms | p95 ms |`);
  console.log('|---|---|---:|---:|');
  for (const result of results) {
    console.log(
      `| ${result.label} | ${result.kind} | ${result.p50.toFixed(1)} | ${result.p95.toFixed(1)} |`,
    );
  }
}

await main();
