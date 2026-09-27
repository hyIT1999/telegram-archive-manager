import type { NestExpressApplication } from '@nestjs/platform-express';
import type { PrismaClient, User } from '@tam/database';
import type { RevokeSessionsResultDto, SessionDto } from '@tam/shared';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { LOGIN_LOCKOUT_SETTINGS } from '../../src/auth/login-attempts.js';
import { createTestPrisma, insertUser, resetDatabase } from './support/database.js';
import { expectApiError, nextClientIp, sessionCookie, sessionSetCookie } from './support/http.js';
import { createTestApp } from './support/test-app.js';

const PASSWORD = 'correct horse battery staple';
const NEW_PASSWORD = 'a brand new passphrase';
/** Short for the suite; production uses 10 failures within 15 minutes. */
const LOCKOUT = { maxFailures: 3, windowMs: 60_000 };
const CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36';

let emailCounter = 0;
/** A fresh email per scenario: lock counters and sessions never leak between tests. */
function nextEmail(): string {
  emailCounter += 1;
  return `account-${emailCounter}@example.test`;
}

describe('account (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let email: string;
  let user: User;

  const http = () => request(app.getHttpServer());

  function login(address = email, password = PASSWORD, ip = nextClientIp()) {
    return http()
      .post('/api/auth/login')
      .set('X-Forwarded-For', ip)
      .set('User-Agent', CHROME_UA)
      .send({ email: address, password });
  }

  async function signIn(address = email, password = PASSWORD): Promise<string> {
    return sessionCookie(await login(address, password).expect(200));
  }

  function changePassword(cookie: string, currentPassword: string, newPassword: string) {
    return http()
      .post('/api/auth/password')
      .set('Cookie', cookie)
      .set('X-Forwarded-For', nextClientIp())
      .send({ currentPassword, newPassword });
  }

  beforeAll(async () => {
    prisma = createTestPrisma();
    await resetDatabase(prisma);
    app = await createTestApp((builder) =>
      builder.overrideProvider(LOGIN_LOCKOUT_SETTINGS).useValue(LOCKOUT),
    );
  });

  beforeEach(async () => {
    email = nextEmail();
    user = await insertUser(prisma, email, PASSWORD);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  describe('lockout after failed sign-ins', () => {
    it('locks the email, whatever the client address, then even the right password waits', async () => {
      for (let i = 0; i < LOCKOUT.maxFailures; i += 1) {
        expectApiError(await login(email, 'wrong password'), 401, 'INVALID_CREDENTIALS');
      }
      const locked = await login(email, PASSWORD);
      const body = expectApiError(locked, 429, 'LOGIN_LOCKED');
      expect(body.message).toBe('Too many failed sign-ins for this email. Try again in 1 minute.');
      const retryAfter = Number(locked.headers['retry-after']);
      expect(retryAfter).toBeGreaterThan(0);
      expect(retryAfter).toBeLessThanOrEqual(60);
      expect(sessionSetCookie(locked)).toBeUndefined();

      // Another account is not affected.
      const other = nextEmail();
      await insertUser(prisma, other, PASSWORD);
      await login(other, PASSWORD).expect(200);
    });

    it('treats unknown emails the same way, so a lock reveals nothing', async () => {
      const unknown = nextEmail();
      for (let i = 0; i < LOCKOUT.maxFailures; i += 1) {
        expectApiError(await login(unknown, 'wrong password'), 401, 'INVALID_CREDENTIALS');
      }
      expectApiError(await login(unknown, 'wrong password'), 429, 'LOGIN_LOCKED');
    });

    it('forgets the failures after a successful sign-in', async () => {
      for (let round = 0; round < 2; round += 1) {
        for (let i = 0; i < LOCKOUT.maxFailures - 1; i += 1) {
          expectApiError(await login(email, 'wrong password'), 401);
        }
        await login(email, PASSWORD).expect(200);
      }
    });
  });

  describe('POST /api/auth/password', () => {
    it('changes the password and signs out every other session', async () => {
      const mine = await signIn();
      const elsewhere = await signIn();

      await changePassword(mine, PASSWORD, NEW_PASSWORD).expect(204);

      await http().get('/api/auth/me').set('Cookie', mine).expect(200);
      expectApiError(await http().get('/api/auth/me').set('Cookie', elsewhere), 401);
      expectApiError(await login(email, PASSWORD), 401, 'INVALID_CREDENTIALS');
      await login(email, NEW_PASSWORD).expect(200);
      expect(await prisma.session.count({ where: { userId: user.id } })).toBe(2);
    });

    it('refuses a wrong current password with 422 (not 401), counting it as a failed sign-in', async () => {
      const cookie = await signIn();
      for (let i = 0; i < LOCKOUT.maxFailures; i += 1) {
        const response = await changePassword(cookie, 'not my password', NEW_PASSWORD);
        expect(expectApiError(response, 422, 'CURRENT_PASSWORD_WRONG').message).toBe(
          'The current password is not correct.',
        );
      }
      expectApiError(await changePassword(cookie, PASSWORD, NEW_PASSWORD), 429, 'LOGIN_LOCKED');
      // The session itself stays valid.
      await http().get('/api/auth/me').set('Cookie', cookie).expect(200);
    });

    it('refuses the same password, a short one and a missing session', async () => {
      const cookie = await signIn();
      expectApiError(await changePassword(cookie, PASSWORD, PASSWORD), 422, 'PASSWORD_UNCHANGED');
      expectApiError(await changePassword(cookie, PASSWORD, 'too short'), 400, 'VALIDATION_FAILED');
      expectApiError(
        await http()
          .post('/api/auth/password')
          .send({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD }),
        401,
      );
    });
  });

  describe('sessions', () => {
    it('lists the live sessions of this user only, marking this browser', async () => {
      const mine = await signIn();
      await signIn();
      const stranger = nextEmail();
      await insertUser(prisma, stranger, PASSWORD);
      await signIn(stranger);
      await prisma.session.create({
        data: {
          userId: user.id,
          tokenHash: 'e'.repeat(64),
          expiresAt: new Date(Date.now() - 1_000),
          absoluteExpiresAt: new Date(Date.now() + 60_000),
        },
      });

      const response = await http().get('/api/auth/sessions').set('Cookie', mine).expect(200);
      const sessions = response.body as SessionDto[];
      expect(sessions).toHaveLength(2);
      expect(sessions.filter((session) => session.current)).toHaveLength(1);
      expect(sessions[0]).toEqual({
        id: expect.any(String),
        current: expect.any(Boolean),
        createdAt: expect.any(String),
        lastSeenAt: expect.any(String),
        expiresAt: expect.any(String),
        ip: expect.stringMatching(/^198\.51\.100\.\d+$/),
        userAgent: CHROME_UA,
      });
      expect(JSON.stringify(sessions)).not.toContain('tokenHash');
    });

    it('signs out another session, and 404s for sessions that are not mine', async () => {
      const mine = await signIn();
      const elsewhere = await signIn();
      const list = (await http().get('/api/auth/sessions').set('Cookie', mine))
        .body as SessionDto[];
      const other = list.find((session) => !session.current);

      await http().delete(`/api/auth/sessions/${other?.id}`).set('Cookie', mine).expect(204);
      expectApiError(await http().get('/api/auth/me').set('Cookie', elsewhere), 401);
      expectApiError(
        await http().delete(`/api/auth/sessions/${other?.id}`).set('Cookie', mine),
        404,
        'NOT_FOUND',
      );

      const stranger = nextEmail();
      await insertUser(prisma, stranger, PASSWORD);
      const theirs = await signIn(stranger);
      const theirList = (await http().get('/api/auth/sessions').set('Cookie', theirs))
        .body as SessionDto[];
      expectApiError(
        await http().delete(`/api/auth/sessions/${theirList[0]?.id}`).set('Cookie', mine),
        404,
      );
      await http().get('/api/auth/me').set('Cookie', theirs).expect(200);
    });

    it('signing out this browser clears its cookie like a logout', async () => {
      const mine = await signIn();
      const list = (await http().get('/api/auth/sessions').set('Cookie', mine))
        .body as SessionDto[];
      const current = list.find((session) => session.current);
      const response = await http()
        .delete(`/api/auth/sessions/${current?.id}`)
        .set('Cookie', mine)
        .expect(204);
      expect(sessionSetCookie(response)).toMatch(/^tam_sid=;/);
      expectApiError(await http().get('/api/auth/me').set('Cookie', mine), 401);
    });

    it('signs out every other session at once', async () => {
      const mine = await signIn();
      const second = await signIn();
      const third = await signIn();
      const response = await http()
        .post('/api/auth/sessions/revoke-others')
        .set('Cookie', mine)
        .expect(200);
      expect(response.body as RevokeSessionsResultDto).toEqual({ revoked: 2 });
      await http().get('/api/auth/me').set('Cookie', mine).expect(200);
      for (const cookie of [second, third]) {
        expectApiError(await http().get('/api/auth/me').set('Cookie', cookie), 401);
      }
    });

    it('needs a session', async () => {
      expectApiError(await http().get('/api/auth/sessions'), 401);
      expectApiError(await http().post('/api/auth/sessions/revoke-others'), 401);
    });
  });
});
