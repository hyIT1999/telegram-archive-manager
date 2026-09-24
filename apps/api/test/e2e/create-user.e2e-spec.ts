import type { NestExpressApplication } from '@nestjs/platform-express';
import type { PrismaClient } from '@tam/database';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { verifyPassword } from '../../src/auth/password.js';
import {
  createUser,
  parseCreateUserArgs,
  passwordFromStdin,
  UserExistsError,
} from '../../src/cli/create-user.command.js';
import { createTestPrisma, resetDatabase } from './support/database.js';
import { nextClientIp } from './support/http.js';
import { createTestApp } from './support/test-app.js';

describe('create-user command against PostgreSQL (e2e)', () => {
  let prisma: PrismaClient;
  let app: NestExpressApplication;

  beforeAll(async () => {
    prisma = createTestPrisma();
    await resetDatabase(prisma);
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('creates a user that can sign in, and is idempotent with --if-missing', async () => {
    const options = parseCreateUserArgs([
      '--email',
      'Owner@Example.TEST',
      '--password-stdin',
      '--if-missing',
    ]);
    if ('help' in options) {
      throw new Error('unexpected help');
    }
    const password = passwordFromStdin('a long enough passphrase\r\n');

    const created = await createUser(prisma, { ...options, password });
    expect(created).toMatchObject({ status: 'created', email: 'owner@example.test' });

    const stored = await prisma.user.findUniqueOrThrow({ where: { email: 'owner@example.test' } });
    expect(stored.passwordHash).toMatch(/^\$argon2id\$/);
    await expect(verifyPassword(stored.passwordHash, 'a long enough passphrase')).resolves.toBe(
      true,
    );

    await expect(
      createUser(prisma, { ...options, password: 'another passphrase' }),
    ).resolves.toEqual({
      status: 'exists',
      email: 'owner@example.test',
    });
    const unchanged = await prisma.user.findUniqueOrThrow({
      where: { email: 'owner@example.test' },
    });
    expect(unchanged.passwordHash).toBe(stored.passwordHash);

    await request(app.getHttpServer())
      .post('/api/auth/login')
      .set('X-Forwarded-For', nextClientIp())
      .send({ email: 'owner@example.test', password: 'a long enough passphrase' })
      .expect(200);
  });

  it('refuses an existing email without --if-missing', async () => {
    await expect(
      createUser(prisma, {
        email: 'owner@example.test',
        password: 'a long enough passphrase',
        ifMissing: false,
      }),
    ).rejects.toBeInstanceOf(UserExistsError);
    expect(await prisma.user.count({ where: { email: 'owner@example.test' } })).toBe(1);
  });
});
