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
