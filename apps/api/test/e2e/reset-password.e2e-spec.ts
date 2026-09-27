import type { NestExpressApplication } from '@nestjs/platform-express';
import type { PrismaClient } from '@tam/database';
import { Redis } from 'ioredis';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { loginFailuresKey } from '../../src/auth/login-lockout.js';
import {
  resetPassword,
  unlockSignIns,
  UserNotFoundError,
} from '../../src/cli/reset-password.command.js';
import { createTestPrisma, insertUser, resetDatabase } from './support/database.js';
import { expectApiError, nextClientIp, sessionCookie } from './support/http.js';
import { createTestApp } from './support/test-app.js';

const EMAIL = 'forgetful@example.test';
const OLD_PASSWORD = 'the old passphrase';
const NEW_PASSWORD = 'the new passphrase';
const PREFIX = 'tamtest';

describe('reset-password command (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let redis: Redis;

  const login = (password: string) =>
    request(app.getHttpServer())
      .post('/api/auth/login')
      .set('X-Forwarded-For', nextClientIp())
      .send({ email: EMAIL, password });

  beforeAll(async () => {
    prisma = createTestPrisma();
    await resetDatabase(prisma);
    await insertUser(prisma, EMAIL, OLD_PASSWORD);
    redis = new Redis(inject('redisUrl'));
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
    redis.disconnect();
    await prisma.$disconnect();
  });

  it('sets the new password, ends every session and lifts a sign-in lock', async () => {
    const before = sessionCookie(await login(OLD_PASSWORD).expect(200));
    await redis.set(loginFailuresKey(PREFIX, EMAIL), '10', 'PX', 60_000);
    expectApiError(await login(OLD_PASSWORD), 429, 'LOGIN_LOCKED');

    const outcome = await resetPassword(prisma, { email: EMAIL, password: NEW_PASSWORD });
    expect(outcome).toMatchObject({ email: EMAIL, sessionsEnded: 1 });
    await expect(unlockSignIns(inject('redisUrl'), PREFIX, EMAIL)).resolves.toBeNull();

    expectApiError(
      await request(app.getHttpServer()).get('/api/auth/me').set('Cookie', before),
      401,
    );
    expectApiError(await login(OLD_PASSWORD), 401, 'INVALID_CREDENTIALS');
    await login(NEW_PASSWORD).expect(200);
  });

  it('reports an unknown email and an unreachable Redis', async () => {
    await expect(
      resetPassword(prisma, { email: 'nobody@example.test', password: NEW_PASSWORD }),
    ).rejects.toBeInstanceOf(UserNotFoundError);
    await expect(unlockSignIns('redis://127.0.0.1:1/0', PREFIX, EMAIL)).resolves.toEqual(
      expect.any(String),
    );
  });
});
