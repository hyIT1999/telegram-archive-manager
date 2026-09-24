import type { NestExpressApplication } from '@nestjs/platform-express';
import type { PrismaClient } from '@tam/database';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestPrisma, insertUser, resetDatabase } from './support/database.js';
import { expectApiError, nextClientIp, sessionCookie, sessionSetCookie } from './support/http.js';
import { createTestApp } from './support/test-app.js';

const EMAIL = 'security@example.test';
const PASSWORD = 'correct horse battery staple';

describe('HTTP security (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;

  const http = () => request(app.getHttpServer());
  const credentials = { email: EMAIL, password: PASSWORD };

  beforeAll(async () => {
    prisma = createTestPrisma();
    await resetDatabase(prisma);
    await insertUser(prisma, EMAIL, PASSWORD);
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  describe('CSRF protection', () => {
    it('rejects a cross-site POST reported by Sec-Fetch-Site', async () => {
      const response = await http()
        .post('/api/auth/login')
        .set('X-Forwarded-For', nextClientIp())
        .set('Sec-Fetch-Site', 'cross-site')
        .send(credentials);
      expectApiError(response, 403);
      expect(sessionSetCookie(response)).toBeUndefined();
      // The rejection happens before routing but still carries the security headers.
      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.headers['cache-control']).toBe('no-store');
    });

    it('rejects a POST whose Origin does not match Host when Sec-Fetch-Site is missing', async () => {
      const response = await http()
        .post('/api/auth/login')
        .set('X-Forwarded-For', nextClientIp())
        .set('Origin', 'http://evil.example')
        .send(credentials);
      expectApiError(response, 403);
    });

    it('allows same-origin requests and the trusted dev-server origin', async () => {
      await http()
        .post('/api/auth/login')
        .set('X-Forwarded-For', nextClientIp())
        .set('Sec-Fetch-Site', 'same-origin')
        .send(credentials)
        .expect(200);
      await http()
        .post('/api/auth/login')
        .set('X-Forwarded-For', nextClientIp())
        .set('Origin', 'http://localhost:4300')
        .send(credentials)
        .expect(200);
    });

    it('never blocks safe methods', async () => {
      await http().get('/api/health/live').set('Sec-Fetch-Site', 'cross-site').expect(200);
    });
  });

  describe('login throttling', () => {
    it('allows 5 attempts per minute and client IP, then answers 429', async () => {
      const ip = nextClientIp();
      const attempt = () =>
        http()
          .post('/api/auth/login')
          .set('X-Forwarded-For', ip)
          .send({ email: EMAIL, password: 'wrong password' });

      for (let i = 0; i < 5; i += 1) {
        expect((await attempt()).status).toBe(401);
      }
      const limited = await attempt();
      expectApiError(limited, 429, 'RATE_LIMITED');
      expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);

      // The correct password does not bypass the limit, but another client is unaffected.
      expect(
        (await http().post('/api/auth/login').set('X-Forwarded-For', ip).send(credentials)).status,
      ).toBe(429);
      await http()
        .post('/api/auth/login')
        .set('X-Forwarded-For', nextClientIp())
        .send(credentials)
        .expect(200);
    });
  });

  describe('responses', () => {
    it('carry the security headers and no X-Powered-By', async () => {
      const response = await http().get('/api/health/live').expect(200);
      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.headers['x-frame-options']).toBe('SAMEORIGIN');
      expect(response.headers['content-security-policy']).toContain("default-src 'self'");
      expect(response.headers['x-powered-by']).toBeUndefined();
    });

    it('are never stored by caches, including user data and errors', async () => {
      const login = await http()
        .post('/api/auth/login')
        .set('X-Forwarded-For', nextClientIp())
        .send(credentials)
        .expect(200);
      expect(login.headers['cache-control']).toBe('no-store');
      const me = await http().get('/api/auth/me').set('Cookie', sessionCookie(login)).expect(200);
      expect(me.headers['cache-control']).toBe('no-store');
      const unauthenticated = await http().get('/api/auth/me');
      expect(unauthenticated.headers['cache-control']).toBe('no-store');
    });

    it('answer unknown routes with a 404 ApiErrorBody', async () => {
      expectApiError(await http().get('/api/does-not-exist'), 404);
    });

    it('answer malformed JSON with a 400 ApiErrorBody', async () => {
      const response = await http()
        .post('/api/auth/login')
        .set('X-Forwarded-For', nextClientIp())
        .set('Content-Type', 'application/json')
        .send('{"email":');
      expectApiError(response, 400);
    });
  });
});
