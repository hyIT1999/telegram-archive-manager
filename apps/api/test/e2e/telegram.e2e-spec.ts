import type { NestExpressApplication } from '@nestjs/platform-express';
import type { PrismaClient } from '@tam/database';
import type { ChannelDto, TelegramDialogListDto, TelegramStatusDto } from '@tam/shared';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createTestPrisma, insertUser } from './support/database.js';
import { FakeWorker } from './support/fake-worker.js';
import { expectApiError, nextClientIp, sessionCookie } from './support/http.js';
import { createTestApp } from './support/test-app.js';

const EMAIL = 'telegram-owner@example.test';
const PASSWORD = 'correct horse battery staple';
const CHANNEL_ID = '-1001234567890';

describe('telegram endpoints (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let cookie: string;
  const worker = new FakeWorker();

  const http = () => request(app.getHttpServer());
  const get = (path: string) => http().get(path).set('Cookie', cookie);
  const post = (path: string, body?: object) =>
    http().post(path).set('Cookie', cookie).set('X-Forwarded-For', nextClientIp()).send(body);

  beforeAll(async () => {
    prisma = createTestPrisma();
    await prisma.$executeRaw`TRUNCATE TABLE users, sessions, telegram_accounts, telegram_dialogs, channels CASCADE`;
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

  afterEach(async () => {
    await worker.reset();
    await prisma.$executeRaw`TRUNCATE TABLE telegram_accounts, telegram_dialogs, channels CASCADE`;
  });

  afterAll(async () => {
    await worker.close();
    await app.close();
    await prisma.$disconnect();
  });

  it.each([
    ['get', '/api/telegram/status'],
    ['post', '/api/telegram/authenticate'],
    ['get', '/api/telegram/chats'],
    ['post', '/api/channels'],
  ] as const)('%s %s requires a session', async (method, path) => {
    expectApiError(await http()[method](path), 401, 'UNAUTHENTICATED');
  });

  describe('GET /api/telegram/status', () => {
    it('reports an offline worker and a logged-out account by default', async () => {
      const response = await get('/api/telegram/status').expect(200);
      expect(response.body).toEqual({
        worker: 'offline',
        connection: null,
        connectionDetail: null,
        state: 'LOGGED_OUT',
        user: null,
        phoneMasked: null,
        codeType: null,
        nextCodeType: null,
        codeResendAt: null,
        lastError: null,
        dialogsRefreshedAt: null,
      } satisfies TelegramStatusDto);
    });

    it('combines the stored login with the worker heartbeat', async () => {
      await worker.setHeartbeat({ state: 'CONNECTED', detail: null });
      await prisma.telegramAccount.create({
        data: {
          accountKey: 'default',
          authState: 'READY',
          telegramUserId: 424_242n,
          username: 'archivist',
          displayName: 'An Archivist',
          phoneMasked: '+84•••••••78',
        },
      });
      const status = (await get('/api/telegram/status').expect(200)).body as TelegramStatusDto;
      expect(status).toMatchObject({
        worker: 'online',
        connection: 'CONNECTED',
        state: 'READY',
        user: { id: '424242', username: 'archivist', displayName: 'An Archivist' },
        phoneMasked: '+84•••••••78',
      });
    });

    it('shows a pending login past its deadline as logged out', async () => {
      await prisma.telegramAccount.create({
        data: {
          accountKey: 'default',
          authState: 'CODE_SENT',
          phoneMasked: '+84•••••••78',
          codeType: 'app',
          codeExpiresAt: new Date(Date.now() - 1_000),
        },
      });
      const status = (await get('/api/telegram/status').expect(200)).body as TelegramStatusDto;
      expect(status).toMatchObject({ state: 'LOGGED_OUT', phoneMasked: null, codeType: null });
    });
  });

  describe('POST /api/telegram/authenticate', () => {
    it('validates the step before contacting the worker', async () => {
      await worker.setHeartbeat({ state: 'CONNECTED', detail: null });
      await worker.listen();
      const response = await post('/api/telegram/authenticate', { step: 'phone', phoneNumber: 'call me' });
      expectApiError(response, 400, 'VALIDATION_FAILED');
      expect(worker.requests).toHaveLength(0);
    });

    it('answers 503 WORKER_UNAVAILABLE without a worker heartbeat', async () => {
      const response = await post('/api/telegram/authenticate', { step: 'phone', phoneNumber: '+84912345678' });
      expectApiError(response, 503, 'WORKER_UNAVAILABLE');
    });

    it('explains why no worker holds the Telegram connection', async () => {
      await worker.setHeartbeat({ state: 'UNCONFIGURED', detail: 'TELEGRAM_API_ID and TELEGRAM_API_HASH are not set' });
      const response = await post('/api/telegram/authenticate', { step: 'phone', phoneNumber: '+84912345678' });
      const body = expectApiError(response, 503, 'TELEGRAM_UNAVAILABLE');
      expect(body.message).toContain('README §4');
    });

    it('forwards the normalized step and returns the state the worker stored', async () => {
      await worker.setHeartbeat({ state: 'CONNECTED', detail: null });
      await worker.listen();
      worker.handler = async () => {
        // The real worker persists the new state before it answers.
        await prisma.telegramAccount.create({
          data: {
            accountKey: 'default',
            authState: 'CODE_SENT',
            phoneMasked: '+84•••••••78',
            codeType: 'app',
            nextCodeType: 'sms',
            codeResendAt: new Date(Date.now() + 60_000),
            codeExpiresAt: new Date(Date.now() + 900_000),
          },
        });
        return { ok: true };
      };

      const response = await post('/api/telegram/authenticate', { step: 'phone', phoneNumber: '+84 912 345 678' }).expect(200);
      expect(worker.requests[0]?.call).toEqual({ method: 'auth.phone', phoneNumber: '+84912345678' });
      expect(response.body).toMatchObject({
        state: 'CODE_SENT',
        phoneMasked: '+84•••••••78',
        codeType: 'app',
        nextCodeType: 'sms',
      });
    });

    it.each([
      [{ code: 'PHONE_CODE_INVALID', message: 'The code is not correct' }, 422],
      [{ code: 'INVALID_LOGIN_STATE', message: 'No login code is pending' }, 409],
      [{ code: 'SOMETHING_UNEXPECTED', message: 'Telegram error' }, 502],
    ])('maps worker error %o to HTTP %i', async (error, status) => {
      await worker.setHeartbeat({ state: 'CONNECTED', detail: null });
      await worker.listen();
      worker.handler = () => ({ ok: false, error });
      const response = await post('/api/telegram/authenticate', { step: 'code', code: '12345' });
      const body = expectApiError(response, status, error.code);
      expect(body.message).toBe(error.message);
    });

    it('passes Telegram rate limits on as 429 with the wait time', async () => {
      await worker.setHeartbeat({ state: 'CONNECTED', detail: null });
      await worker.listen();
      worker.handler = () => ({
        ok: false,
        error: { code: 'FLOOD_WAIT', message: 'Telegram asks to wait 60 s', retryAfterSeconds: 60 },
      });
      const body = expectApiError(await post('/api/telegram/authenticate', { step: 'resend' }), 429, 'FLOOD_WAIT');
      expect(body.details).toEqual({ retryAfterSeconds: 60 });
    });

    it('gives up with 504 when the worker does not answer', async () => {
      await worker.setHeartbeat({ state: 'CONNECTED', detail: null });
      await worker.listen();
      worker.handler = () => 'silent';
      const response = await post('/api/telegram/authenticate', { step: 'password', password: 'secret' });
      expectApiError(response, 504, 'TELEGRAM_TIMEOUT');
    });
  });

  describe('chat list', () => {
    it('lists cached chats with their archive link and refresh state', async () => {
      await prisma.telegramDialog.createMany({
        data: [
          { telegramChatId: BigInt(CHANNEL_ID), title: 'Lessons', username: 'lessons', type: 'CHANNEL' },
          { telegramChatId: -200n, title: 'Family', type: 'GROUP', memberCount: 5 },
          { telegramChatId: -1003n, title: 'Protected club', type: 'SUPERGROUP', isProtected: true },
        ],
      });
      const channel = await prisma.channel.create({
        data: { telegramChatId: BigInt(CHANNEL_ID), title: 'Lessons', type: 'CHANNEL' },
      });
      await worker.setRefreshing(true);

      const list = (await get('/api/telegram/chats').expect(200)).body as TelegramDialogListDto;
      expect(list.refreshing).toBe(true);
      expect(list.items.map((item) => [item.title, item.archivedChannelId, item.isProtected])).toEqual([
        ['Family', null, false],
        ['Lessons', channel.id, false],
        ['Protected club', null, true],
      ]);
      expect(list.items[1]).toMatchObject({ telegramChatId: CHANNEL_ID, type: 'CHANNEL', username: 'lessons' });
    });

    it('asks the worker to refresh the list', async () => {
      await worker.setHeartbeat({ state: 'CONNECTED', detail: null });
      await worker.listen();
      await post('/api/telegram/chats/refresh').expect(202);
      expect(worker.requests.map((item) => item.call.method)).toEqual(['dialogs.refresh']);

      worker.handler = () => ({ ok: false, error: { code: 'TELEGRAM_NOT_READY', message: 'Log in to Telegram first' } });
      expectApiError(await post('/api/telegram/chats/refresh'), 409, 'TELEGRAM_NOT_READY');
    });
  });

  describe('POST /api/channels', () => {
    it('rejects ids that are not Telegram ids and chats that are not in the list', async () => {
      expectApiError(await post('/api/channels', { telegramChatId: 'abc' }), 400, 'VALIDATION_FAILED');
      expectApiError(await post('/api/channels', { telegramChatId: CHANNEL_ID }), 404, 'DIALOG_NOT_FOUND');
    });

    it('refuses chats with content protection', async () => {
      await prisma.telegramDialog.create({
        data: { telegramChatId: -1003n, title: 'Protected club', type: 'SUPERGROUP', isProtected: true },
      });
      expectApiError(await post('/api/channels', { telegramChatId: '-1003' }), 422, 'CHAT_PROTECTED');
      expect(await prisma.channel.count()).toBe(0);
    });

    it('creates the channel from the cached chat once, then returns it again', async () => {
      await prisma.telegramDialog.create({
        data: {
          telegramChatId: BigInt(CHANNEL_ID),
          title: 'Lessons',
          username: 'lessons',
          type: 'CHANNEL',
          accessHash: 987_654n,
          memberCount: 1_200,
        },
      });

      const created = (await post('/api/channels', { telegramChatId: CHANNEL_ID }).expect(201)).body as ChannelDto;
      expect(created).toMatchObject({
        telegramChatId: CHANNEL_ID,
        title: 'Lessons',
        username: 'lessons',
        type: 'CHANNEL',
        memberCount: 1_200,
        isProtected: false,
        stats: { messages: 0, media: 0, downloadedMedia: 0, storageBytes: 0 },
      });
      expect(JSON.stringify(created)).not.toContain('987654');

      const again = (await post('/api/channels', { telegramChatId: CHANNEL_ID }).expect(200)).body as ChannelDto;
      expect(again.id).toBe(created.id);
      expect(await prisma.channel.count()).toBe(1);
    });

    it('creates a single channel when the same chat is submitted concurrently', async () => {
      await prisma.telegramDialog.create({ data: { telegramChatId: BigInt(CHANNEL_ID), title: 'Lessons', type: 'CHANNEL' } });
      const responses = await Promise.all([
        post('/api/channels', { telegramChatId: CHANNEL_ID }),
        post('/api/channels', { telegramChatId: CHANNEL_ID }),
      ]);
      expect(responses.map((response) => response.status).sort()).toEqual([200, 201]);
      expect(await prisma.channel.count()).toBe(1);
    });
  });
});
