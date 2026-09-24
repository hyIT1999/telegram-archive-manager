import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { RedisLease } from '../../src/telegram/redis-lease.js';

const KEY = 'tamtestw:lease:test';

describe('RedisLease', () => {
  const redis = new Redis(inject('redisUrl'), { lazyConnect: true });

  beforeAll(async () => {
    await redis.connect();
    await redis.del(KEY);
  });
  afterAll(async () => {
    await redis.del(KEY);
    await redis.quit();
  });

  it('gives the lease to one owner at a time', async () => {
    const first = new RedisLease(redis, KEY, 5_000, 'worker-a');
    const second = new RedisLease(redis, KEY, 5_000, 'worker-b');

    expect(await first.tryAcquire()).toBe(true);
    expect(await second.tryAcquire()).toBe(false);
    expect(await first.renew()).toBe(true);
    expect(await second.renew()).toBe(false);

    // Only the owner can release.
    await second.release();
    expect(await redis.get(KEY)).toBe(first.token);
    await first.release();
    expect(await redis.exists(KEY)).toBe(0);

    expect(await second.tryAcquire()).toBe(true);
    await second.release();
  });

  it('expires when the owner stops renewing', async () => {
    const lease = new RedisLease(redis, KEY, 200, 'worker-a');
    expect(await lease.tryAcquire()).toBe(true);
    await expect.poll(() => redis.exists(KEY), { timeout: 2_000 }).toBe(0);
    expect(await lease.renew()).toBe(false);
  });
});
