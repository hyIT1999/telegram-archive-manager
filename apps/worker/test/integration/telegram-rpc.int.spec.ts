import { randomUUID } from 'node:crypto';
import type { ConfigService } from '@nestjs/config';
import type { PrismaService } from '@tam/database/nest';
import {
  REDIS_KEYS,
  type TelegramRpcCall,
  type TelegramRpcReply,
  telegramRpcChannels,
  telegramRpcReplySchema,
} from '@tam/shared';
import { type Chat, FloodWaitError } from '@tam/telegram';
import { Redis } from 'ioredis';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';
import type { WorkerEnv } from '../../src/config/env.schema.js';
import { ACCOUNT_KEY, TelegramAuthService } from '../../src/telegram/telegram-auth.service.js';
import { TelegramDialogsService } from '../../src/telegram/telegram-dialogs.service.js';
import { TelegramRpcServer } from '../../src/telegram/telegram-rpc.server.js';
import {
  createFakeTelegramApi,
  randomSecretBox,
  resetTelegramTables,
  testPrisma,
} from './support/telegram-fixtures.js';

const PREFIX = 'tamtestw';
const CHANNELS = telegramRpcChannels(PREFIX);
const REPLY_CHANNEL = `${CHANNELS.replyPrefix}worker-rpc-test`;

describe('TelegramRpcServer', () => {
  let prisma: PrismaService;
  const redisUrl = inject('redisUrl');
  const commands = new Redis(redisUrl, { lazyConnect: true });
  const replies = new Redis(redisUrl, { lazyConnect: true });
  const received = new Map<string, TelegramRpcReply>();
  let server: TelegramRpcServer;
  let fake: ReturnType<typeof createFakeTelegramApi>;
  let dialogs: TelegramDialogsService;

  beforeAll(async () => {
    prisma = testPrisma();
    await commands.connect();
    await replies.connect();
    replies.on('message', (_channel: string, raw: string) => {
      const reply = telegramRpcReplySchema.parse(JSON.parse(raw));
      received.set(reply.id, reply);
    });
    await replies.subscribe(REPLY_CHANNEL);
  });
  afterAll(async () => {
    await prisma.$disconnect();
    await commands.quit();
    await replies.quit();
  });

  beforeEach(async () => {
    await resetTelegramTables(prisma);
    received.clear();
    fake = createFakeTelegramApi();
    const auth = new TelegramAuthService(prisma, fake.provider, randomSecretBox());
    dialogs = new TelegramDialogsService(prisma, fake.provider, auth, commands);
    const settings: Record<string, string> = { REDIS_URL: redisUrl, BULLMQ_PREFIX: PREFIX };
    const config = { get: (key: string) => settings[key] } as unknown as ConfigService<WorkerEnv, true>;
    server = new TelegramRpcServer(config, commands, auth, dialogs);
    await server.start();
  });
  afterEach(async () => {
    await server.stop();
    await dialogs.idle();
  });

  async function send(
    call: TelegramRpcCall,
    deadline = Date.now() + 5_000,
    replyTo = REPLY_CHANNEL,
  ): Promise<{ id: string; receivers: number }> {
    const id = randomUUID();
    const receivers = await commands.publish(
      CHANNELS.request,
      JSON.stringify({ id, replyTo, deadline, call }),
    );
    return { id, receivers };
  }

  async function call(request: TelegramRpcCall): Promise<TelegramRpcReply> {
    const { id, receivers } = await send(request);
    expect(receivers).toBe(1);
    await expect.poll(() => received.has(id)).toBe(true);
    return received.get(id)!;
  }

  it('runs login steps and answers success', async () => {
    await expect(call({ method: 'auth.phone', phoneNumber: '+84912345678' })).resolves.toMatchObject({ ok: true });
    const account = await prisma.telegramAccount.findUniqueOrThrow({ where: { accountKey: ACCOUNT_KEY } });
    expect(account.authState).toBe('CODE_SENT');

    let finishRefresh: (chats: Chat[]) => void = () => undefined;
    fake.api.getChats.mockImplementationOnce(() => new Promise((resolve) => (finishRefresh = resolve)));
    await expect(call({ method: 'auth.code', code: '12345' })).resolves.toMatchObject({ ok: true });
    // A successful login starts the first chat list refresh, visible as soon as the reply arrives.
    expect(await commands.exists(REDIS_KEYS.telegramDialogsRefreshing)).toBe(1);
    await expect.poll(() => fake.api.getChats.mock.calls.length).toBe(1);
    finishRefresh([]);
    await dialogs.idle();
    expect(await commands.exists(REDIS_KEYS.telegramDialogsRefreshing)).toBe(0);
  });

  it('answers failures with stable codes and the Telegram wait time', async () => {
    await expect(call({ method: 'auth.code', code: '12345' })).resolves.toMatchObject({
      ok: false,
      error: { code: 'INVALID_LOGIN_STATE' },
    });

    fake.api.sendCode.mockRejectedValueOnce(new FloodWaitError(120));
    await expect(call({ method: 'auth.phone', phoneNumber: '+84912345678' })).resolves.toMatchObject({
      ok: false,
      error: { code: 'FLOOD_WAIT', retryAfterSeconds: 120 },
    });

    fake.api.sendCode.mockRejectedValueOnce(new TypeError('socket exploded'));
    const reply = await call({ method: 'auth.phone', phoneNumber: '+84912345678' });
    expect(reply).toMatchObject({ ok: false, error: { code: 'TELEGRAM_ERROR' } });
    expect(JSON.stringify(reply)).not.toContain('socket exploded');
  });

  it('skips requests whose caller already gave up, and ignores malformed ones', async () => {
    const expired = await send({ method: 'auth.phone', phoneNumber: '+84912345678' }, Date.now() - 1);
    await commands.publish(CHANNELS.request, 'not json');
    await commands.publish(CHANNELS.request, JSON.stringify({ id: 'x', call: {} }));

    // The server keeps working after garbage and never ran the expired request.
    await expect(call({ method: 'dialogs.refresh' })).resolves.toMatchObject({
      ok: false,
      error: { code: 'TELEGRAM_NOT_READY' },
    });
    await server.drained();
    expect(received.has(expired.id)).toBe(false);
    expect(fake.api.sendCode).not.toHaveBeenCalled();
  });

  it('listens only on its own deployment and answers only to it', async () => {
    const elsewhere = telegramRpcChannels('another-deployment');
    const other = await commands.publish(
      elsewhere.request,
      JSON.stringify({ id: randomUUID(), replyTo: REPLY_CHANNEL, deadline: Date.now() + 5_000, call: { method: 'auth.logout' } }),
    );
    expect(other).toBe(0);

    const foreign = await send(
      { method: 'auth.phone', phoneNumber: '+84912345678' },
      Date.now() + 5_000,
      `${elsewhere.replyPrefix}api`,
    );
    expect(foreign.receivers).toBe(1);
    await server.drained();
    expect(fake.api.sendCode).not.toHaveBeenCalled();
  });

  it('stops receiving requests once stopped (PUBLISH reaches nobody)', async () => {
    await server.stop();
    const { receivers } = await send({ method: 'auth.logout' });
    expect(receivers).toBe(0);
  });
});
