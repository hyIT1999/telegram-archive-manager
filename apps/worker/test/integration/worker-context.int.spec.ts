import { hostname } from 'node:os';
import { getQueueToken } from '@nestjs/bullmq';
import { NestFactory } from '@nestjs/core';
import { PrismaService } from '@tam/database/nest';
import { ALL_QUEUES, QUEUES, REDIS_KEYS } from '@tam/shared';
import type { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, inject, it, vi } from 'vitest';
import { heartbeatTtlMs, type WorkerHeartbeat } from '../../src/heartbeat/heartbeat.js';
import { ShutdownCoordinator } from '../../src/shutdown/index.js';
import { WorkerModule } from '../../src/worker.module.js';
import { TEST_BULLMQ_PREFIX, TEST_DATABASE, TEST_HEARTBEAT_INTERVAL_MS } from './test-env.js';

function bootWorker() {
  return NestFactory.createApplicationContext(WorkerModule, { logger: false, abortOnError: false });
}

describe('worker application context', () => {
  const redis = new Redis(inject('redisUrl'), { lazyConnect: true });

  beforeAll(() => redis.connect());
  afterAll(() => redis.quit());

  async function readHeartbeat(): Promise<WorkerHeartbeat | null> {
    const raw = await redis.get(REDIS_KEYS.workerHeartbeat);
    return raw === null ? null : (JSON.parse(raw) as WorkerHeartbeat);
  }

  it('registers a producer for every queue, reaches the database and runs the processors', async () => {
    const app = await bootWorker();
    try {
      for (const name of ALL_QUEUES) {
        const queue = app.get<Queue>(getQueueToken(name));
        expect(queue.name).toBe(name);
        expect(queue.opts.prefix).toBe(TEST_BULLMQ_PREFIX);
      }

      const prisma = app.get(PrismaService);
      const [row] = await prisma.$queryRaw<{ database: string; application: string }[]>`
        SELECT current_database() AS database, current_setting('application_name') AS application`;
      expect(row).toEqual({ database: TEST_DATABASE, application: 'tam-worker' });
      await expect(prisma.channel.count()).resolves.toBeTypeOf('number');

      expect(
        app
          .get(ShutdownCoordinator)
          .workers()
          .map((worker) => worker.name),
      ).toEqual([QUEUES.telegramImport, QUEUES.mediaDownload]);
    } finally {
      await app.close();
    }
  });

  it('keeps a heartbeat with a TTL while running and deletes it on close', async () => {
    const app = await bootWorker();
    try {
      // The first beat is written during bootstrap.
      const first = await readHeartbeat();
      expect(first).toMatchObject({ pid: process.pid, host: hostname() });
      expect(Date.parse(first?.startedAt ?? '')).toBeLessThanOrEqual(Date.parse(first?.ts ?? ''));

      const ttl = await redis.pttl(REDIS_KEYS.workerHeartbeat);
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(heartbeatTtlMs(TEST_HEARTBEAT_INTERVAL_MS));

      // Later beats rewrite the timestamp and renew the TTL; startedAt stays the same.
      await vi.waitFor(
        async () => {
          const next = await readHeartbeat();
          expect(next?.ts).not.toBe(first?.ts);
          expect(next?.startedAt).toBe(first?.startedAt);
        },
        { timeout: 5 * TEST_HEARTBEAT_INTERVAL_MS, interval: 100 },
      );
      expect(await redis.pttl(REDIS_KEYS.workerHeartbeat)).toBeGreaterThan(0);
    } finally {
      await app.close();
    }
    expect(await redis.exists(REDIS_KEYS.workerHeartbeat)).toBe(0);
  });

  it('reports in its heartbeat that Telegram is not configured', async () => {
    const app = await bootWorker();
    try {
      expect((await readHeartbeat())?.telegram).toEqual({
        state: 'UNCONFIGURED',
        detail: 'TELEGRAM_API_ID and TELEGRAM_API_HASH are not set',
      });
    } finally {
      await app.close();
    }
  });

  it('does not delete a heartbeat another worker wrote in the meantime', async () => {
    const app = await bootWorker();
    const now = new Date().toISOString();
    const replacement = JSON.stringify({ ts: now, pid: -1, host: 'replacement', startedAt: now });
    try {
      // Act right after one of our beats, so the next one is a full interval away.
      const current = await readHeartbeat();
      await vi.waitFor(async () => expect((await readHeartbeat())?.ts).not.toBe(current?.ts), {
        timeout: 5 * TEST_HEARTBEAT_INTERVAL_MS,
        interval: 20,
      });
      // A replacement worker started before this one finished shutting down.
      await redis.set(REDIS_KEYS.workerHeartbeat, replacement, 'PX', 60_000);
    } finally {
      await app.close();
    }
    expect(await redis.get(REDIS_KEYS.workerHeartbeat)).toBe(replacement);
    await redis.del(REDIS_KEYS.workerHeartbeat);
  });
});
