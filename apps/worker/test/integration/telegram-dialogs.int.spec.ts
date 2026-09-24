import type { PrismaService } from '@tam/database/nest';
import { REDIS_KEYS } from '@tam/shared';
import { AuthRequiredError, type Chat } from '@tam/telegram';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';
import { ACCOUNT_KEY, TelegramAuthService } from '../../src/telegram/telegram-auth.service.js';
import { TelegramDialogsService } from '../../src/telegram/telegram-dialogs.service.js';
import {
  chat,
  createFakeTelegramApi,
  randomSecretBox,
  resetTelegramTables,
  testPrisma,
} from './support/telegram-fixtures.js';

describe('TelegramDialogsService', () => {
  let prisma: PrismaService;
  const redis = new Redis(inject('redisUrl'), { lazyConnect: true });

  beforeAll(async () => {
    prisma = testPrisma();
    await redis.connect();
  });
  afterAll(async () => {
    await prisma.$disconnect();
    await redis.quit();
  });
  beforeEach(async () => {
    await resetTelegramTables(prisma);
    await redis.del(REDIS_KEYS.telegramDialogsRefreshing);
  });

  async function setup({ ready = true } = {}) {
    const fake = createFakeTelegramApi();
    const auth = new TelegramAuthService(prisma, fake.provider, randomSecretBox());
    const dialogs = new TelegramDialogsService(prisma, fake.provider, auth, redis);
    await prisma.telegramAccount.create({
      data: { accountKey: ACCOUNT_KEY, authState: ready ? 'READY' : 'LOGGED_OUT' },
    });
    return { ...fake, auth, dialogs };
  }

  async function refresh(dialogs: TelegramDialogsService): Promise<void> {
    await dialogs.startRefresh();
    await dialogs.idle();
  }

  it('requires a logged-in account', async () => {
    const { dialogs, api } = await setup({ ready: false });
    await expect(dialogs.startRefresh()).rejects.toMatchObject({ code: 'TELEGRAM_NOT_READY' });
    expect(api.getChats).not.toHaveBeenCalled();
  });

  it('stores the chat list and records when it was refreshed', async () => {
    const { dialogs, api } = await setup();
    api.getChats.mockResolvedValueOnce([
      chat('-1001', { title: 'Lessons', username: 'lessons' }),
      chat('-200', { type: 'GROUP', accessHash: null }),
      chat('-1003', { type: 'SUPERGROUP', isProtected: true, isForum: true }),
    ]);
    await refresh(dialogs);

    const rows = await prisma.telegramDialog.findMany({ orderBy: { telegramChatId: 'asc' } });
    expect(rows.map((row) => [row.telegramChatId.toString(), row.type, row.isProtected])).toEqual([
      ['-1003', 'SUPERGROUP', true],
      ['-1001', 'CHANNEL', false],
      ['-200', 'GROUP', false],
    ]);
    expect(rows.find((row) => row.telegramChatId === -1001n)?.accessHash).toBe(1234n);
    const account = await prisma.telegramAccount.findUniqueOrThrow({ where: { accountKey: ACCOUNT_KEY } });
    expect(account.dialogsRefreshedAt).not.toBeNull();
    expect(await redis.exists(REDIS_KEYS.telegramDialogsRefreshing)).toBe(0);
  });

  it('drops chats that disappeared and keeps archived channels in step', async () => {
    const { dialogs, api } = await setup();
    api.getChats.mockResolvedValueOnce([chat('-1001'), chat('-1002')]);
    await refresh(dialogs);
    await prisma.channel.create({
      data: { telegramChatId: -1002n, title: 'Old title', type: 'CHANNEL', syncEnabled: true },
    });

    api.getChats.mockResolvedValueOnce([chat('-1002', { title: 'New title', isProtected: true })]);
    await refresh(dialogs);

    const ids = (await prisma.telegramDialog.findMany()).map((row) => row.telegramChatId.toString());
    expect(ids).toEqual(['-1002']);
    const channel = await prisma.channel.findUniqueOrThrow({ where: { telegramChatId: -1002n } });
    expect(channel).toMatchObject({ title: 'New title', isProtected: true, syncEnabled: false });
  });

  it('runs one refresh at a time and shows the flag while running', async () => {
    const { dialogs, api } = await setup();
    let release!: (chats: Chat[]) => void;
    api.getChats.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));

    await dialogs.startRefresh();
    // The flag is already visible when startRefresh resolves (the api reads it right after).
    expect(await redis.exists(REDIS_KEYS.telegramDialogsRefreshing)).toBe(1);
    await dialogs.startRefresh();
    await expect.poll(() => api.getChats.mock.calls.length).toBe(1);
    release([chat('-1001')]);
    await dialogs.idle();

    expect(api.getChats).toHaveBeenCalledTimes(1);
    expect(await redis.exists(REDIS_KEYS.telegramDialogsRefreshing)).toBe(0);
  });

  it('marks the account logged out when Telegram revoked the session', async () => {
    const { dialogs, api } = await setup();
    api.getChats.mockRejectedValueOnce(new AuthRequiredError());
    await refresh(dialogs);
    const account = await prisma.telegramAccount.findUniqueOrThrow({ where: { accountKey: ACCOUNT_KEY } });
    expect(account).toMatchObject({ authState: 'LOGGED_OUT' });
    expect(account.lastError).toMatch(/revoked/);
  });
});
