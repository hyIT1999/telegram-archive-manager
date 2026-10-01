import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Channel, PrismaClient, StorageLocation } from '@tam/database';
import {
  type ChannelBackupDto,
  type ChannelDto,
  type MessageBackupDto,
  type MessageDto,
  type StorageLocationDto,
  type TelegramRpcRequest,
  backupVerifyingKey,
} from '@tam/shared';
import { Redis } from 'ioredis';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';
import { archiveRows } from './support/archive-rows.js';
import { createTestPrisma, insertUser, resetDatabase } from './support/database.js';
import { FakeWorker } from './support/fake-worker.js';
import { expectApiError, nextClientIp, sessionCookie } from './support/http.js';
import { createTestApp } from './support/test-app.js';

const EMAIL = 'backups@example.test';
const PASSWORD = 'correct horse battery staple';
const BACKUP_CHAT = '-1007770000001';

interface ChatRights {
  canPost?: boolean;
  canManageTopics?: boolean;
  isForum?: boolean;
  type?: 'CHANNEL' | 'SUPERGROUP' | 'GROUP';
  title?: string;
}

describe('Telegram backups (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let redis: Redis;
  let cookie: string;
  const worker = new FakeWorker();
  const rows = archiveRows(() => prisma);

  const http = () => request(app.getHttpServer());
  const get = (path: string) => http().get(path).set('Cookie', cookie);
  const post = (path: string, body?: object) => http().post(path).set('Cookie', cookie).send(body);
  const patch = (path: string, body: object) => http().patch(path).set('Cookie', cookie).send(body);

  /** The worker reads the chat into telegram_dialogs before answering, like the real one. */
  function answerChecksWith(rights: ChatRights): void {
    worker.handler = async (call: TelegramRpcRequest) => {
      if (call.call.method === 'backup.checkChat') {
        const telegramChatId = BigInt(call.call.telegramChatId);
        const values = {
          title: rights.title ?? 'Backups',
          type: rights.type ?? 'SUPERGROUP',
          isForum: rights.isForum ?? true,
          canPost: rights.canPost ?? true,
          canManageTopics: rights.canManageTopics ?? true,
        };
        await prisma.telegramDialog.upsert({
          where: { telegramChatId },
          create: { telegramChatId, ...values },
          update: values,
        });
      }
      return { ok: true };
    };
  }

  async function addBackupChat(rights: ChatRights = {}): Promise<StorageLocationDto> {
    answerChecksWith(rights);
    const response = await post('/api/storage/telegram', { telegramChatId: BACKUP_CHAT }).expect(
      201,
    );
    return response.body as StorageLocationDto;
  }

  async function removeTelegramLocations(): Promise<void> {
    await prisma.$executeRaw`UPDATE channels SET backup_location_id = NULL`;
    await prisma.$executeRaw`DELETE FROM message_backups`;
    await prisma.storageLocation.deleteMany({ where: { kind: 'TELEGRAM' } });
  }

  beforeAll(async () => {
    prisma = createTestPrisma();
    redis = new Redis(inject('redisUrl'));
    await resetDatabase(prisma);
    await removeTelegramLocations();
    await insertUser(prisma, EMAIL, PASSWORD);
    app = await createTestApp();
    const login = await http()
      .post('/api/auth/login')
      .set('X-Forwarded-For', nextClientIp())
      .send({ email: EMAIL, password: PASSWORD })
      .expect(200);
    cookie = sessionCookie(login);
    await worker.connect();
  });

  beforeEach(async () => {
    await worker.setHeartbeat({ state: 'CONNECTED', detail: null });
    await worker.listen();
  });

  afterEach(async () => {
    await worker.reset();
    await removeTelegramLocations();
    await prisma.$executeRaw`TRUNCATE TABLE telegram_dialogs, channels, app_settings CASCADE`;
  });

  afterAll(async () => {
    await worker.close();
    await redis.quit();
    await app.close();
    await prisma.$disconnect();
  });

  it.each([
    ['post', '/api/storage/telegram'],
    ['get', '/api/channels/0199a0b1-0000-7000-8000-000000000001/backup'],
    ['post', '/api/messages/0199a0b1-0000-7000-8000-000000000001/backup'],
  ] as const)('%s %s requires a session', async (method, path) => {
    expectApiError(await http()[method](path), 401, 'UNAUTHENTICATED');
  });

  describe('backup chats', () => {
    it('adds a chat the account may post in, named after it, and never as the default', async () => {
      const chat = await addBackupChat({ title: 'Course backups' });
      expect(chat).toMatchObject({
        kind: 'TELEGRAM',
        name: 'Course backups',
        displayPath: 'Telegram › Course backups',
        telegram: {
          telegramChatId: BACKUP_CHAT,
          type: 'SUPERGROUP',
          username: null,
          isForum: true,
        },
        isDefault: false,
        accountEmail: null,
        channelCount: 0,
      });
      expect(worker.requests.map((call) => call.call)).toEqual([
        { method: 'backup.checkChat', telegramChatId: BACKUP_CHAT },
      ]);
      expectApiError(
        await post('/api/storage/telegram', { telegramChatId: BACKUP_CHAT }),
        409,
        'LOCATION_EXISTS',
      );
      expectApiError(
        await patch(`/api/storage/locations/${chat.id}`, { isDefault: true }),
        422,
        'LOCATION_KIND_NOT_ALLOWED',
      );
      const list = await get('/api/storage/locations').expect(200);
      expect(list.body.items.map((item: StorageLocationDto) => item.kind)).toContain('TELEGRAM');
    });

    it('refuses chats the account may not post in, forums without topics, and archived chats', async () => {
      answerChecksWith({ canPost: false });
      expectApiError(
        await post('/api/storage/telegram', { telegramChatId: BACKUP_CHAT }),
        422,
        'BACKUP_CHAT_NOT_WRITABLE',
      );
      answerChecksWith({ isForum: true, canManageTopics: false });
      expectApiError(
        await post('/api/storage/telegram', { telegramChatId: BACKUP_CHAT }),
        422,
        'BACKUP_CHAT_NO_TOPICS',
      );
      answerChecksWith({ type: 'GROUP' });
      expectApiError(
        await post('/api/storage/telegram', { telegramChatId: BACKUP_CHAT }),
        422,
        'BACKUP_CHAT_NOT_WRITABLE',
      );
      await rows.addChannel({ telegramChatId: BigInt(BACKUP_CHAT) });
      worker.requests.length = 0;
      expectApiError(
        await post('/api/storage/telegram', { telegramChatId: BACKUP_CHAT }),
        409,
        'BACKUP_CHAT_ARCHIVED',
      );
      // Refused before asking Telegram.
      expect(worker.requests).toEqual([]);
    });

    it('says when the worker is not running', async () => {
      await worker.reset();
      expectApiError(
        await post('/api/storage/telegram', { telegramChatId: BACKUP_CHAT }),
        503,
        'WORKER_UNAVAILABLE',
      );
    });

    it('checks the chat again through the worker and keeps what is wrong', async () => {
      const chat = await addBackupChat();
      answerChecksWith({ canPost: false, title: 'Renamed' });
      const failed = await post(`/api/storage/locations/${chat.id}/check`).expect(200);
      expect(failed.body).toMatchObject({
        ok: false,
        space: null,
        location: {
          displayPath: 'Telegram › Renamed',
          lastError: expect.stringContaining('may not post'),
        },
      });
      answerChecksWith({});
      const fine = await post(`/api/storage/locations/${chat.id}/check`).expect(200);
      expect(fine.body).toMatchObject({ ok: true, location: { lastError: null } });
    });

    it('keeps a chat that receives backups out of the archive', async () => {
      await addBackupChat();
      expectApiError(
        await post('/api/channels', { telegramChatId: BACKUP_CHAT }),
        422,
        'CHAT_IS_BACKUP_TARGET',
      );
      const dialogs = await get('/api/telegram/chats').expect(200);
      expect(dialogs.body.items[0]).toMatchObject({
        telegramChatId: BACKUP_CHAT,
        canPost: true,
        canManageTopics: true,
        backupLocationId: expect.any(String),
      });
    });
  });

  describe('a channel backed up to Telegram', () => {
    let chat: StorageLocationDto;
    let channel: Channel;

    beforeEach(async () => {
      chat = await addBackupChat();
      channel = await rows.addChannel();
      await rows.addMessage(channel, 1);
      await rows.addMessage(channel, 2, { mediaGroupId: 77n }, { type: 'VIDEO' });
      await rows.addMessage(channel, 3, { mediaGroupId: 77n }, { type: 'VIDEO' });
      await rows.addMessage(channel, 4, { type: 'SERVICE', text: null });
      await rows.addMessage(channel, 5, { type: 'POLL', text: 'Which day?' });
    });

    const backupsOf = (channelId: string) =>
      prisma.messageBackup.findMany({
        where: { channelId },
        include: { message: { select: { telegramMessageId: true } } },
        orderBy: { message: { telegramMessageId: 'asc' } },
      });

    it('chooses a Telegram chat, never a folder, and creates a row per message when switched on', async () => {
      const local = await prisma.storageLocation
        .findFirstOrThrow({ where: { kind: 'LOCAL' } })
        .catch(() =>
          prisma.storageLocation.create({
            data: {
              kind: 'LOCAL',
              name: 'Folder',
              displayPath: '/data',
              target: '/data',
              config: { path: '/data' },
            },
          }),
        );
      expectApiError(
        await patch(`/api/channels/${channel.id}`, { storageLocationId: chat.id }),
        422,
        'LOCATION_KIND_NOT_ALLOWED',
      );
      expectApiError(
        await patch(`/api/channels/${channel.id}`, { backupLocationId: local.id }),
        422,
        'LOCATION_KIND_NOT_ALLOWED',
      );
      expectApiError(
        await patch(`/api/channels/${channel.id}`, { backupEnabled: true }),
        422,
        'BACKUP_CHAT_MISSING',
      );

      const response = await patch(`/api/channels/${channel.id}`, {
        backupLocationId: chat.id,
        backupEnabled: true,
      }).expect(200);
      const dto = response.body as ChannelDto;
      expect(dto.backupLocation).toEqual({
        id: chat.id,
        kind: 'TELEGRAM',
        name: 'Backups',
        displayPath: 'Telegram › Backups',
      });
      expect(dto.backupEnabled).toBe(true);
      const backups = await backupsOf(channel.id);
      // The service message gets no row; the poll cannot be recreated.
      expect(
        backups.map((row) => [row.message.telegramMessageId, row.status, row.skipReason]),
      ).toEqual([
        [1, 'PENDING', null],
        [2, 'PENDING', null],
        [3, 'PENDING', null],
        [5, 'SKIPPED', 'UNSUPPORTED'],
      ]);
      // Switching on again creates nothing new.
      await patch(`/api/channels/${channel.id}`, { backupEnabled: true }).expect(200);
      expect(await backupsOf(channel.id)).toHaveLength(4);
      if (local.displayPath === '/data') {
        await prisma.storageLocation.delete({ where: { id: local.id } });
      }
    });

    it('never backs up a protected chat', async () => {
      await prisma.channel.update({ where: { id: channel.id }, data: { isProtected: true } });
      expectApiError(
        await patch(`/api/channels/${channel.id}`, {
          backupLocationId: chat.id,
          backupEnabled: true,
        }),
        422,
        'CHAT_PROTECTED',
      );
    });

    it('takes back running backups when switched off, but lets a send finish', async () => {
      await patch(`/api/channels/${channel.id}`, {
        backupLocationId: chat.id,
        backupEnabled: true,
      }).expect(200);
      const [text, first] = await backupsOf(channel.id);
      await prisma.messageBackup.update({
        where: { id: text!.id },
        data: { status: 'ACTIVE', stage: 'UPLOADING' },
      });
      await prisma.messageBackup.update({
        where: { id: first!.id },
        data: { status: 'ACTIVE', stage: 'SENDING' },
      });
      await patch(`/api/channels/${channel.id}`, { backupEnabled: false }).expect(200);
      const after = await backupsOf(channel.id);
      expect(after[0]).toMatchObject({ status: 'PENDING', stage: null });
      expect(after[1]).toMatchObject({ status: 'ACTIVE', stage: 'SENDING' });
    });

    it('sums up the backup: counts, bytes, what runs and what failed', async () => {
      await patch(`/api/channels/${channel.id}`, {
        backupLocationId: chat.id,
        backupEnabled: true,
      }).expect(200);
      const [text, first, second] = await backupsOf(channel.id);
      await prisma.messageBackup.update({
        where: { id: text!.id },
        data: {
          status: 'COMPLETED',
          backupMessageId: 900,
          completedAt: new Date(),
          verifiedAt: new Date(),
        },
      });
      await prisma.messageBackup.update({
        where: { id: first!.id },
        data: { status: 'ACTIVE', stage: 'UPLOADING', uploadedBytes: 500n },
      });
      await prisma.messageBackup.update({
        where: { id: second!.id },
        data: {
          status: 'FAILED',
          attempts: 8,
          error: 'Telegram error 500',
          lastAttemptAt: new Date(),
        },
      });

      const summary = (await get(`/api/channels/${channel.id}/backup`).expect(200))
        .body as ChannelBackupDto;
      expect(summary).toMatchObject({
        channelId: channel.id,
        backupEnabled: true,
        paused: false,
        chat: { id: chat.id, telegramChatId: BACKUP_CHAT, isForum: true, lastError: null },
        messages: { pending: 0, active: 1, completed: 1, failed: 1, skipped: 1 },
        bytes: { total: 5_000, uploaded: 0, remaining: 2_000 },
        verify: { running: false, ok: 1, problems: 0 },
      });
      expect(summary.active).toEqual([
        expect.objectContaining({
          telegramMessageId: 2,
          name: 'lesson-2.mp4',
          uploadedBytes: 500,
          stage: 'UPLOADING',
        }),
      ]);
      expect(summary.failures).toEqual([
        expect.objectContaining({ telegramMessageId: 3, error: 'Telegram error 500', attempts: 8 }),
      ]);

      expect((await post(`/api/channels/${channel.id}/backup/retry`).expect(200)).body).toEqual({
        queued: 1,
      });
      expect(
        await prisma.messageBackup.findUniqueOrThrow({ where: { id: second!.id } }),
      ).toMatchObject({
        status: 'PENDING',
        attempts: 0,
        error: null,
      });
    });

    it('asks the worker to verify, and shows that it runs', async () => {
      expectApiError(
        await post(`/api/channels/${channel.id}/backup/verify`),
        422,
        'BACKUP_CHAT_MISSING',
      );
      await patch(`/api/channels/${channel.id}`, { backupLocationId: chat.id }).expect(200);
      await redis.set(backupVerifyingKey(channel.id), '1', 'PX', 10_000);
      const response = await post(`/api/channels/${channel.id}/backup/verify`).expect(202);
      expect((response.body as ChannelBackupDto).verify.running).toBe(true);
      expect(worker.requests.at(-1)?.call).toEqual({
        method: 'backup.verify',
        channelId: channel.id,
      });
      await redis.del(backupVerifyingKey(channel.id));
    });

    it('backs up one message now with the rest of its album, and again when asked', async () => {
      const album = await prisma.message.findMany({
        where: { channelId: channel.id, mediaGroupId: 77n },
        orderBy: { telegramMessageId: 'asc' },
      });
      expectApiError(
        await post(`/api/messages/${album[0]!.id}/backup`),
        422,
        'BACKUP_CHAT_MISSING',
      );
      // Backup stays off: a chosen chat is enough for single messages.
      await patch(`/api/channels/${channel.id}`, { backupLocationId: chat.id }).expect(200);
      const service = await prisma.message.findFirstOrThrow({
        where: { channelId: channel.id, type: 'SERVICE' },
      });
      expectApiError(await post(`/api/messages/${service.id}/backup`), 422, 'BACKUP_NOT_SUPPORTED');

      const queued = await post(`/api/messages/${album[0]!.id}/backup`).expect(202);
      expect((queued.body as MessageBackupDto).requested).toBe(true);
      const members = await prisma.messageBackup.findMany({
        where: { messageId: { in: album.map((message) => message.id) } },
      });
      expect(members).toHaveLength(2);
      expect(members.every((row) => row.status === 'PENDING' && row.requestedAt !== null)).toBe(
        true,
      );
      // Nothing more to do while it waits.
      await post(`/api/messages/${album[1]!.id}/backup`).expect(200);

      // Once copied, the detail links to the copy; "Back up again" remembers it to replace it.
      await prisma.messageBackup.updateMany({
        where: { messageId: { in: album.map((message) => message.id) } },
        data: { status: 'COMPLETED', backupMessageId: 901, completedAt: new Date() },
      });
      const detail = (await get(`/api/messages/${album[0]!.id}`).expect(200)).body as MessageDto;
      expect(detail.backups).toEqual([
        expect.objectContaining({
          status: 'COMPLETED',
          url: 'https://t.me/c/7770000001/901',
          chat: { id: chat.id, name: 'Backups', displayPath: 'Telegram › Backups' },
        }),
      ]);
      // The same copies alone, for a page that follows the backup.
      expect((await get(`/api/messages/${album[0]!.id}/backups`).expect(200)).body).toEqual(
        detail.backups,
      );
      expectApiError(
        await get('/api/messages/0199a0b1-0000-7000-8000-00000000dead/backups'),
        404,
        'NOT_FOUND',
      );
      await post(`/api/messages/${album[0]!.id}/backup`).expect(200);
      const again = await post(`/api/messages/${album[0]!.id}/backup`, { force: true }).expect(202);
      expect(again.body).toMatchObject({ status: 'PENDING', url: null, requested: true });
      const replaced = await prisma.messageBackup.findFirstOrThrow({
        where: { messageId: album[0]!.id },
      });
      expect(replaced).toMatchObject({
        force: true,
        replacePrevious: true,
        replacedMessageIds: [901],
        backupMessageId: null,
      });

      await prisma.messageBackup.update({
        where: { id: replaced.id },
        data: { status: 'ACTIVE', stage: 'UPLOADING' },
      });
      expectApiError(
        await post(`/api/messages/${album[0]!.id}/backup`, { force: true }),
        409,
        'BACKUP_ACTIVE',
      );
    });

    it('pauses every backup in Settings, letting a send finish', async () => {
      await patch(`/api/channels/${channel.id}`, {
        backupLocationId: chat.id,
        backupEnabled: true,
      }).expect(200);
      const [text, first] = await backupsOf(channel.id);
      await prisma.messageBackup.update({
        where: { id: text!.id },
        data: { status: 'ACTIVE', stage: 'UPLOADING' },
      });
      await prisma.messageBackup.update({
        where: { id: first!.id },
        data: { status: 'ACTIVE', stage: 'SENDING' },
      });
      const settings = await patch('/api/settings', { backups: { paused: true } }).expect(200);
      expect(settings.body.backups).toEqual({ paused: true });
      const after = await backupsOf(channel.id);
      expect(after[0]).toMatchObject({ status: 'PENDING' });
      expect(after[1]).toMatchObject({ status: 'ACTIVE', stage: 'SENDING' });
      expect((await get(`/api/channels/${channel.id}/backup`).expect(200)).body.paused).toBe(true);
    });

    it('keeps a backup chat that holds copies', async () => {
      await patch(`/api/channels/${channel.id}`, {
        backupLocationId: chat.id,
        backupEnabled: true,
      }).expect(200);
      expectApiError(
        await http().delete(`/api/storage/locations/${chat.id}`).set('Cookie', cookie),
        409,
        'LOCATION_IN_USE',
      );
    });
  });
});

// Keeps the StorageLocation type import meaningful for readers of the fixtures above.
export type { StorageLocation };
