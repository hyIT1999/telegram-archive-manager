import { HealthIndicatorService } from '@nestjs/terminus';
import type { PrismaService } from '@tam/database/nest';
import { REDIS_KEYS } from '@tam/shared';
import type { Redis } from 'ioredis';
import { describe, expect, it, vi } from 'vitest';
import { HealthService } from '../../src/health/health.service.js';

function serviceWith(options: {
  query?: () => Promise<unknown>;
  ping?: () => Promise<string>;
  heartbeat?: string | null;
}): { service: HealthService; get: ReturnType<typeof vi.fn> } {
  const prisma = {
    $queryRaw: vi.fn(options.query ?? (() => Promise.resolve([{ '?column?': 1 }]))),
  };
  const get = vi.fn().mockResolvedValue(options.heartbeat ?? null);
  const redis = { ping: vi.fn(options.ping ?? (() => Promise.resolve('PONG'))), get };
  const service = new HealthService(
    prisma as unknown as PrismaService,
    redis as unknown as Redis,
    new HealthIndicatorService(),
  );
  return { service, get };
}

describe('HealthService.readiness', () => {
  it('is ok when PostgreSQL and Redis answer, even without a worker', async () => {
    const { service, get } = serviceWith({});
    await expect(service.readiness()).resolves.toEqual({
      status: 'ok',
      checks: { database: 'up', redis: 'up' },
      worker: { status: 'missing', lastSeenAt: null },
    });
    expect(get).toHaveBeenCalledWith(REDIS_KEYS.workerHeartbeat);
  });

  it('reports a live worker from its heartbeat', async () => {
    const heartbeat = JSON.stringify({
      ts: '2026-09-24T01:00:00.000Z',
      pid: 7,
      host: 'srv',
      startedAt: '2026-09-24T00:59:00.000Z',
    });
    const { service } = serviceWith({ heartbeat });
    await expect(service.readiness()).resolves.toMatchObject({
      status: 'ok',
      worker: { status: 'alive', lastSeenAt: '2026-09-24T01:00:00.000Z' },
    });
  });

  it('fails when the database is down', async () => {
    const { service } = serviceWith({ query: () => Promise.reject(new Error('ECONNREFUSED')) });
    await expect(service.readiness()).resolves.toMatchObject({
      status: 'error',
      checks: { database: 'down', redis: 'up' },
    });
  });

  it('fails when Redis is down and then cannot see the worker', async () => {
    const { service } = serviceWith({
      ping: () => Promise.reject(new Error('Connection is closed.')),
      heartbeat: JSON.stringify({ ts: '2026-09-24T01:00:00.000Z' }),
    });
    await expect(service.readiness()).resolves.toEqual({
      status: 'error',
      checks: { database: 'up', redis: 'down' },
      worker: { status: 'missing', lastSeenAt: null },
    });
  });

  it('answers within the probe timeout when a dependency hangs', async () => {
    const { service } = serviceWith({ query: () => new Promise(() => undefined) });
    const started = Date.now();
    await expect(service.readiness()).resolves.toMatchObject({
      status: 'error',
      checks: { database: 'down' },
    });
    expect(Date.now() - started).toBeLessThan(5_000);
  });
});
