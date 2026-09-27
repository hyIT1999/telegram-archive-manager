import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, inject } from 'vitest';
import { TEST_BULLMQ_PREFIX, TEST_HEARTBEAT_INTERVAL_MS } from './test-env.js';

// Each test file (its own process state) gets its own file for the heartbeat to touch.
const aliveFile = path.join(tmpdir(), `tam-worker-it-${process.pid}-${Date.now()}.alive`);
afterAll(() => rmSync(aliveFile, { force: true }));

// WorkerModule validates process.env as soon as it is imported, so the test environment is set
// here, before any test file loads the module.
Object.assign(process.env, {
  NODE_ENV: 'test',
  DATABASE_URL: inject('databaseUrl'),
  REDIS_URL: inject('redisUrl'),
  BULLMQ_PREFIX: TEST_BULLMQ_PREFIX,
  WORKER_HEARTBEAT_INTERVAL_MS: String(TEST_HEARTBEAT_INTERVAL_MS),
  WORKER_ALIVE_FILE: aliveFile,
});

// A booted worker must never connect to real Telegram or touch the real session database.
for (const key of [
  'TELEGRAM_API_ID',
  'TELEGRAM_API_HASH',
  'TELEGRAM_SESSION_DATABASE_URL',
  'TELEGRAM_SESSION_KEY',
]) {
  delete process.env[key];
}
