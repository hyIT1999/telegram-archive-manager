import { createPrismaClient, type PrismaClient, type User } from '@tam/database';
import { inject } from 'vitest';
import { hashPassword } from '../../../src/auth/password.js';

/** A separate client for arranging and inspecting the e2e database. */
export function createTestPrisma(): PrismaClient {
  return createPrismaClient({ url: inject('databaseUrl'), max: 2, applicationName: 'tam-api-e2e' });
}

/** Every test file starts from empty tables. */
export async function resetDatabase(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRaw`
    TRUNCATE TABLE users, sessions, telegram_accounts, telegram_dialogs, channels, messages,
      media, tags, message_tags, import_jobs, download_jobs, app_settings CASCADE`;
}

export async function insertUser(
  prisma: PrismaClient,
  email: string,
  password: string,
): Promise<User> {
  return prisma.user.create({ data: { email, passwordHash: await hashPassword(password) } });
}
