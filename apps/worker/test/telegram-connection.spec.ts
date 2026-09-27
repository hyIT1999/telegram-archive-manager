import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The mtcute client, the encrypted session storage and the Redis lease are replaced: this test
// is about the order in which the connection wires them together.
const mocks = vi.hoisted(() => ({
  client: { connect: vi.fn(), destroy: vi.fn() },
  session: { storage: {}, close: vi.fn() },
  adapter: { onUpdate: vi.fn(), startUpdates: vi.fn() },
  lease: { tryAcquire: vi.fn(), renew: vi.fn(), release: vi.fn() },
  clientOptions: [] as { onFloodWait: (method: string, seconds: number) => void }[],
}));

vi.mock('@tam/telegram', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tam/telegram')>()),
  createSessionStorage: vi.fn(() => mocks.session),
  createMtcuteClient: vi.fn(
    (options: { onFloodWait: (method: string, seconds: number) => void }) => {
      mocks.clientOptions.push(options);
      return mocks.client;
    },
  ),
  MtcuteTelegramAdapter: vi.fn(function MtcuteTelegramAdapter() {
    return mocks.adapter;
  }),
}));

vi.mock('../src/telegram/redis-lease.js', () => ({
  RedisLease: vi.fn(function RedisLease() {
    return mocks.lease;
  }),
}));

const { LEASE_RENEW_INTERVAL_MS, TelegramConnection } =
  await import('../src/telegram/telegram-connection.js');
const { TelegramUpdates } = await import('../src/telegram/telegram-updates.js');
const { TelegramUnavailableError } = await import('../src/telegram/telegram.tokens.js');

const SETTINGS = {
  configured: true as const,
  apiId: 1,
  apiHash: '0123456789abcdef0123456789abcdef',
  sessionDatabaseUrl: 'postgresql://tam:secret@localhost:5432/tam_tg',
  sessionKey: 'key',
};

function connection(settings: object = SETTINGS, box: object | null = {}) {
  const cooldown = { note: vi.fn() };
  const updates = new TelegramUpdates();
  const config = { get: () => 'info' };
  const subject = new TelegramConnection(
    settings as never,
    box as never,
    {} as never,
    config as never,
    cooldown as never,
    updates,
  );
  return { subject, cooldown, updates };
}

describe('TelegramConnection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.clientOptions.length = 0;
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('refuses to connect without credentials', async () => {
    await expect(
      connection({ configured: false, reason: 'off' }).subject.connect(),
    ).rejects.toThrow('Telegram is not configured');
    await expect(connection(SETTINGS, null).subject.connect()).rejects.toThrow(
      'Telegram is not configured',
    );
  });

  it('offers the Telegram API only while connected', async () => {
    const { subject } = connection();
    expect(() => subject.api).toThrow(TelegramUnavailableError);
    await subject.connect();
    expect(subject.api).toBe(mocks.adapter);
    await subject.disconnect();
    expect(() => subject.api).toThrow(TelegramUnavailableError);
    expect(mocks.client.destroy).toHaveBeenCalled();
    expect(mocks.session.close).toHaveBeenCalled();
  });

  it('passes updates on and starts them on the current client only, logging it once', async () => {
    const { subject, updates } = connection();
    const received: unknown[] = [];
    updates.listen((event) => received.push(event));
    await subject.connect();

    const handler = mocks.adapter.onUpdate.mock.calls[0]?.[0] as (event: unknown) => void;
    const event = { kind: 'new_message', chatId: '-100', messageId: '5' };
    handler(event);
    expect(received).toEqual([event]);

    await expect(updates.start()).resolves.toBe(true);
    await expect(updates.start()).resolves.toBe(true);
    expect(mocks.adapter.startUpdates).toHaveBeenCalledTimes(2);
    const logged = vi.mocked(Logger.prototype.log).mock.calls.map(([message]) => message);
    expect(logged.filter((message) => message === 'Receiving updates from Telegram')).toHaveLength(
      1,
    );

    await subject.disconnect();
    await expect(updates.start()).resolves.toBe(false);
  });

  it('turns a flood wait into a cooldown', async () => {
    const { subject, cooldown } = connection();
    await subject.connect();
    mocks.clientOptions[0]?.onFloodWait('messages.getHistory', 42);
    expect(cooldown.note).toHaveBeenCalledWith(42);
  });

  it('closes whatever it can when closing fails', async () => {
    const { subject } = connection();
    await subject.connect();
    mocks.client.destroy.mockRejectedValueOnce(new Error('socket gone'));
    mocks.session.close.mockRejectedValueOnce(new Error('database gone'));
    await expect(subject.disconnect()).resolves.toBeUndefined();
    await expect(subject.disconnect()).resolves.toBeUndefined();
  });

  it('keeps the owner lease alive and reports losing it', async () => {
    vi.useFakeTimers();
    const { subject } = connection();
    const lost = vi.fn();
    subject.onLeaseLost(lost);
    mocks.lease.tryAcquire.mockResolvedValueOnce(false);
    await expect(subject.acquireLease()).resolves.toBe(false);

    mocks.lease.tryAcquire.mockResolvedValueOnce(true);
    await expect(subject.acquireLease()).resolves.toBe(true);
    // Redis unreachable for a moment: the lease lives on until its TTL.
    mocks.lease.renew.mockRejectedValueOnce(new Error('ECONNRESET'));
    await vi.advanceTimersByTimeAsync(LEASE_RENEW_INTERVAL_MS);
    expect(lost).not.toHaveBeenCalled();
    mocks.lease.renew.mockResolvedValueOnce(true);
    await vi.advanceTimersByTimeAsync(LEASE_RENEW_INTERVAL_MS);
    expect(lost).not.toHaveBeenCalled();

    mocks.lease.renew.mockResolvedValueOnce(false);
    await vi.advanceTimersByTimeAsync(LEASE_RENEW_INTERVAL_MS);
    expect(lost).toHaveBeenCalledTimes(1);
    // No more renewals once it is gone.
    await vi.advanceTimersByTimeAsync(3 * LEASE_RENEW_INTERVAL_MS);
    expect(mocks.lease.renew).toHaveBeenCalledTimes(3);

    mocks.lease.release.mockRejectedValueOnce(new Error('ECONNRESET'));
    await expect(subject.releaseLease()).resolves.toBeUndefined();
  });
});
