import { inject } from 'vitest';
import { TEST_BULLMQ_PREFIX, TEST_HEARTBEAT_INTERVAL_MS } from './test-env.js';

// WorkerModule validates process.env as soon as it is imported, so the test environment is set
// here, before any test file loads the module.
Object.assign(process.env, {
  NODE_ENV: 'test',
  DATABASE_URL: inject('databaseUrl'),
  REDIS_URL: inject('redisUrl'),
  BULLMQ_PREFIX: TEST_BULLMQ_PREFIX,
  WORKER_HEARTBEAT_INTERVAL_MS: String(TEST_HEARTBEAT_INTERVAL_MS),
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
