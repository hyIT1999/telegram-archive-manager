import { inject } from 'vitest';

// Runs before each test file imports AppModule (whose ConfigModule validates the environment
// at import time). Real variables win over the root .env, so the suite is independent of the
// developer's settings apart from the database/Redis credentials.
Object.assign(process.env, {
  NODE_ENV: 'test',
  LOG_LEVEL: 'error',
  DATABASE_URL: inject('databaseUrl'),
  REDIS_URL: inject('redisUrl'),
  BULLMQ_PREFIX: 'tamtest',
  API_HOST: '127.0.0.1',
  API_PORT: '3100',
  COOKIE_SECURE: 'false',
  SESSION_TTL_HOURS: '168',
  SESSION_ABSOLUTE_TTL_DAYS: '30',
  CSRF_TRUSTED_ORIGINS: 'http://localhost:4300',
  TRUST_PROXY: 'loopback',
  // Short, so the "worker never answers" scenario does not slow the suite down.
  TELEGRAM_RPC_TIMEOUT_MS: '1500',
});
