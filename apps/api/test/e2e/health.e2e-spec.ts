import type { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaService } from '@tam/database/nest';
import type { HealthReadyDto } from '@tam/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from './support/test-app.js';

describe('health (e2e)', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/health/live answers without a session and is not cached', async () => {
    const response = await request(app.getHttpServer()).get('/api/health/live').expect(200);
    expect(response.body).toEqual({ status: 'ok' });
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('GET /api/health/ready reports PostgreSQL and Redis up; the worker is informational', async () => {
    const response = await request(app.getHttpServer()).get('/api/health/ready').expect(200);
    const body = response.body as HealthReadyDto;
    expect(body).toMatchObject({ status: 'ok', checks: { database: 'up', redis: 'up' } });
    expect(['alive', 'missing']).toContain(body.worker.status);
    if (body.worker.status === 'missing') {
      expect(body.worker.lastSeenAt).toBeNull();
    }
  });

  it('is exempt from rate limiting', async () => {
    const response = await request(app.getHttpServer()).get('/api/health/ready');
    expect(response.headers['x-ratelimit-limit']).toBeUndefined();
  });

  describe('when PostgreSQL is unreachable', () => {
    let degraded: NestExpressApplication;

    beforeAll(async () => {
      const unreachable = {
        $queryRaw: () => Promise.reject(new Error('connect ECONNREFUSED 127.0.0.1:5432')),
      };
      degraded = await createTestApp((builder) =>
        builder.overrideProvider(PrismaService).useValue(unreachable),
      );
    });

    afterAll(async () => {
      await degraded.close();
    });

    it('GET /api/health/ready answers 503 with the same body shape', async () => {
      const response = await request(degraded.getHttpServer()).get('/api/health/ready').expect(503);
      expect(response.body).toMatchObject({
        status: 'error',
        checks: { database: 'down', redis: 'up' },
      });
      expect(response.body).not.toHaveProperty('message');
    });

    it('GET /api/health/live still answers 200', async () => {
      await request(degraded.getHttpServer()).get('/api/health/live').expect(200);
    });
  });
});
