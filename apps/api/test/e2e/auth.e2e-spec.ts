import type { NestExpressApplication } from '@nestjs/platform-express';
import type { PrismaClient, Session, User } from '@tam/database';
import type { AuthUserDto } from '@tam/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashSessionToken } from '../../src/auth/session-token.js';
import { createTestPrisma, insertUser, resetDatabase } from './support/database.js';
import { expectApiError, nextClientIp, sessionCookie, sessionSetCookie } from './support/http.js';
import { createTestApp } from './support/test-app.js';

const EMAIL = 'admin@example.test';
const PASSWORD = 'correct horse battery staple';
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const TTL_MS = 168 * HOUR;
const ABSOLUTE_TTL_MS = 30 * 24 * HOUR;
const CLEARED_COOKIE =
  'tam_sid=; Path=/api; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Strict';

describe('auth (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let user: User;

  const http = () => request(app.getHttpServer());

  function login(email = EMAIL, password = PASSWORD) {
    return http()
      .post('/api/auth/login')
      .set('X-Forwarded-For', nextClientIp())
      .send({ email, password });
  }

  async function loggedInCookie(): Promise<string> {
    return sessionCookie(await login().expect(200));
  }

  function findSession(cookie: string): Promise<Session | null> {
    const token = cookie.slice('tam_sid='.length);
    return prisma.session.findUnique({ where: { tokenHash: hashSessionToken(token) } });
  }

  async function sessionOf(cookie: string): Promise<Session> {
    const session = await findSession(cookie);
    if (!session) {
      throw new Error('session row not found');
    }
    return session;
  }

  beforeAll(async () => {
    prisma = createTestPrisma();
    await resetDatabase(prisma);
    user = await insertUser(prisma, EMAIL, PASSWORD);
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  describe('POST /api/auth/login', () => {
    it('rejects a wrong password with a generic 401 and no cookie', async () => {
      const response = await login(EMAIL, 'not the password');
      expect(expectApiError(response, 401, 'INVALID_CREDENTIALS').message).toBe(
        'Invalid email or password',
      );
      expect(sessionSetCookie(response)).toBeUndefined();
    });

    it('answers an unknown email exactly like a wrong password', async () => {
      const unknown = await login('nobody@example.test', PASSWORD);
      const wrong = await login(EMAIL, 'not the password');
      expect(unknown.status).toBe(401);
      expect(unknown.body).toEqual(wrong.body);
    });

    it('validates the body and lists the offending fields', async () => {
      const response = await http()
        .post('/api/auth/login')
        .set('X-Forwarded-For', nextClientIp())
        .send({ email: 'not-an-email' });
      const body = expectApiError(response, 400, 'VALIDATION_FAILED');
      expect(body.details).toEqual([
        { path: 'email', message: expect.any(String) },
        { path: 'password', message: expect.any(String) },
      ]);
    });

    it('signs in with a case-insensitive email and sets a hardened session cookie', async () => {
      const before = Date.now();
      const response = await login('  ADMIN@Example.TEST ', PASSWORD).expect(200);

      const body = response.body as AuthUserDto;
      expect(body).toEqual({ id: user.id, email: EMAIL, lastLoginAt: expect.any(String) });
      expect(Date.parse(body.lastLoginAt ?? '')).toBeGreaterThanOrEqual(before - 1_000);

      const setCookie = sessionSetCookie(response) ?? '';
      expect(setCookie).toMatch(/^tam_sid=[A-Za-z0-9_-]{43};/);
      expect(setCookie).toContain('; Max-Age=604800;');
      expect(setCookie).toContain('; Path=/api;');
      expect(setCookie).toContain('; HttpOnly');
      expect(setCookie).toContain('; SameSite=Strict');
      expect(setCookie).not.toContain('Secure');

      // Only the sha256 of the token is stored, with the client address seen through the proxy.
      const cookie = sessionCookie(response);
      const session = await sessionOf(cookie);
      expect(session.userId).toBe(user.id);
      expect(session.ip).toMatch(/^198\.51\.100\.\d+$/);
      expect(
        await prisma.session.count({ where: { tokenHash: cookie.slice('tam_sid='.length) } }),
      ).toBe(0);
      expect(session.expiresAt.getTime() - session.lastSeenAt.getTime()).toBe(TTL_MS);
      expect(session.absoluteExpiresAt.getTime() - session.lastSeenAt.getTime()).toBe(
        ABSOLUTE_TTL_MS,
      );
    });

    it("removes the user's expired sessions when signing in", async () => {
      const past = new Date(Date.now() - HOUR);
      const stale = await prisma.session.create({
        data: {
          userId: user.id,
          tokenHash: 'e'.repeat(64),
          expiresAt: past,
          absoluteExpiresAt: past,
        },
      });
      await loggedInCookie();
      expect(await prisma.session.findUnique({ where: { id: stale.id } })).toBeNull();
    });
  });

  describe('GET /api/auth/me', () => {
    it('returns the signed-in user', async () => {
      const cookie = await loggedInCookie();
      const response = await http().get('/api/auth/me').set('Cookie', cookie).expect(200);
      expect(response.body).toEqual({ id: user.id, email: EMAIL, lastLoginAt: expect.any(String) });
    });

    it('rejects requests without a valid session', async () => {
      expectApiError(await http().get('/api/auth/me'), 401, 'UNAUTHENTICATED');
      const forged = await http()
        .get('/api/auth/me')
        .set('Cookie', `tam_sid=${'x'.repeat(43)}`);
      expectApiError(forged, 401, 'UNAUTHENTICATED');
      expect(sessionSetCookie(forged)).toBe(CLEARED_COOKIE);
    });

    it('does not write while the session was seen recently', async () => {
      const cookie = await loggedInCookie();
      const before = await sessionOf(cookie);
      const response = await http().get('/api/auth/me').set('Cookie', cookie).expect(200);
      expect(sessionSetCookie(response)).toBeUndefined();
      expect((await sessionOf(cookie)).lastSeenAt).toEqual(before.lastSeenAt);
    });

    it('slides the expiry once lastSeenAt is older than five minutes', async () => {
      const cookie = await loggedInCookie();
      const { id } = await sessionOf(cookie);
      await prisma.session.update({
        where: { id },
        data: {
          lastSeenAt: new Date(Date.now() - 10 * MINUTE),
          expiresAt: new Date(Date.now() + HOUR),
        },
      });

      const requestedAt = Date.now();
      const response = await http().get('/api/auth/me').set('Cookie', cookie).expect(200);

      const slid = await sessionOf(cookie);
      expect(slid.lastSeenAt.getTime()).toBeGreaterThanOrEqual(requestedAt - 1_000);
      expect(slid.expiresAt.getTime() - slid.lastSeenAt.getTime()).toBe(TTL_MS);
      expect(sessionSetCookie(response)).toContain('; Max-Age=604800;');
    });

    it('never slides past the absolute expiry', async () => {
      const cookie = await loggedInCookie();
      const { id } = await sessionOf(cookie);
      const absoluteExpiresAt = new Date(Date.now() + 2 * HOUR);
      await prisma.session.update({
        where: { id },
        data: {
          lastSeenAt: new Date(Date.now() - 10 * MINUTE),
          expiresAt: new Date(Date.now() + HOUR),
          absoluteExpiresAt,
        },
      });
      await http().get('/api/auth/me').set('Cookie', cookie).expect(200);
      expect((await sessionOf(cookie)).expiresAt).toEqual(absoluteExpiresAt);
    });

    it('rejects an expired session, deletes it and clears the cookie', async () => {
      const cookie = await loggedInCookie();
      const { id } = await sessionOf(cookie);
      await prisma.session.update({
        where: { id },
        data: { expiresAt: new Date(Date.now() - 1_000) },
      });

      const response = await http().get('/api/auth/me').set('Cookie', cookie);
      expectApiError(response, 401, 'UNAUTHENTICATED');
      expect(sessionSetCookie(response)).toBe(CLEARED_COOKIE);
      expect(await findSession(cookie)).toBeNull();
    });

    it('rejects a session past its absolute expiry', async () => {
      const cookie = await loggedInCookie();
      const { id } = await sessionOf(cookie);
      await prisma.session.update({
        where: { id },
        data: { absoluteExpiresAt: new Date(Date.now() - 1_000) },
      });
      expectApiError(
        await http().get('/api/auth/me').set('Cookie', cookie),
        401,
        'UNAUTHENTICATED',
      );
    });
  });

  describe('POST /api/auth/logout', () => {
    it('revokes the session, clears the cookie with the same attributes, and answers 204', async () => {
      const cookie = await loggedInCookie();
      const response = await http().post('/api/auth/logout').set('Cookie', cookie).expect(204);
      expect(sessionSetCookie(response)).toBe(CLEARED_COOKIE);
      expect(await findSession(cookie)).toBeNull();
      expectApiError(
        await http().get('/api/auth/me').set('Cookie', cookie),
        401,
        'UNAUTHENTICATED',
      );
    });

    it('is idempotent without a session', async () => {
      const response = await http().post('/api/auth/logout').expect(204);
      expect(sessionSetCookie(response)).toBe(CLEARED_COOKIE);
    });
  });
});
