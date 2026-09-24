import { REDIS_KEYS } from '@tam/shared';
import { Redis } from 'ioredis';

/** Re-created and migrated by globalSetup; never the development database. */
export const TEST_DATABASE = 'tam_test_worker';
/** Redis database reserved for these tests (the api's end-to-end tests use 15). */
export const TEST_REDIS_DB = 14;
export const TEST_BULLMQ_PREFIX = 'tamtestw';
/** Short interval so a test can watch the heartbeat refresh. */
export const TEST_HEARTBEAT_INTERVAL_MS = 1_000;

/** The same Redis URL pointing at another logical database. */
export function withRedisDb(redisUrl: string, db: number): string {
  const url = new URL(redisUrl);
  url.pathname = `/${db}`;
  return url.toString();
}

/** Deletes the heartbeat and every `tamtestw:*` key, and only in the test database. */
export async function clearTestKeys(redisUrl: string): Promise<void> {
  if (new URL(redisUrl).pathname !== `/${TEST_REDIS_DB}`) {
    throw new Error(`Refusing to clear keys outside Redis database ${TEST_REDIS_DB}`);
  }
  const redis = new Redis(redisUrl, { lazyConnect: true });
  try {
    await redis.connect();
    const keys: string[] = [REDIS_KEYS.workerHeartbeat];
    for await (const batch of redis.scanStream({ match: `${TEST_BULLMQ_PREFIX}:*`, count: 500 })) {
      keys.push(...(batch as string[]));
    }
    await redis.del(...keys);
  } finally {
    redis.disconnect();
  }
}
