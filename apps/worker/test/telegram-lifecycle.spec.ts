import { TelegramAuthState, TelegramConnectionState } from '@tam/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DIALOGS_STALE_AFTER_MS, TelegramLifecycle } from '../src/telegram/telegram-lifecycle.js';
import type { TelegramSettings } from '../src/telegram/telegram-settings.js';

const CONFIGURED: TelegramSettings = {
  configured: true,
  apiId: 1,
  apiHash: '0123456789abcdef0123456789abcdef',
  sessionDatabaseUrl: 'postgresql://tam:secret@localhost:5432/tam_tg',
  sessionKey: 'key',
};

/** The lifecycle's collaborators, each a fake that records what happened in one shared log. */
function setUp(
  options: {
    settings?: TelegramSettings;
    lease?: boolean[];
    authState?: TelegramAuthState;
    connectError?: Error;
    updatesError?: Error;
    dialogsRefreshedAt?: Date | null;
  } = {},
) {
  const log: string[] = [];
  const states: { state: TelegramConnectionState; detail: string | null }[] = [];
  const leases = [...(options.lease ?? [true])];
  let leaseLost: (() => void) | undefined;
  const status = {
    setTelegram: vi.fn((state: TelegramConnectionState, detail: string | null = null) => {
      states.push({ state, detail });
    }),
  };
  const connection = {
    acquireLease: vi.fn(async () => leases.shift() ?? true),
    onLeaseLost: vi.fn((listener: () => void) => {
      leaseLost = listener;
    }),
    connect: vi.fn(async () => {
      log.push('connect');
      if (options.connectError) {
        throw options.connectError;
      }
    }),
    disconnect: vi.fn(async () => {
      log.push('disconnect');
    }),
    releaseLease: vi.fn(async () => {
      log.push('release lease');
    }),
  };
  const auth = { initialize: vi.fn(async () => options.authState ?? TelegramAuthState.READY) };
  const dialogs = {
    idle: vi.fn(async () => {
      log.push('dialogs idle');
    }),
    startRefresh: vi.fn(async () => {
      log.push('refresh dialogs');
    }),
  };
  const rpc = {
    start: vi.fn(async () => {
      log.push('rpc start');
    }),
    stop: vi.fn(async () => {
      log.push('rpc stop');
    }),
  };
  const redis = { close: vi.fn(async () => undefined) };
  const prisma = {
    telegramAccount: {
      findUnique: vi.fn(async () =>
        options.dialogsRefreshedAt === undefined
          ? null
          : { dialogsRefreshedAt: options.dialogsRefreshedAt },
      ),
    },
  };
  const updates = {
    start: vi.fn(async () => {
      log.push('updates');
      if (options.updatesError) {
        throw options.updatesError;
      }
      return true;
    }),
  };
  const lifecycle = new TelegramLifecycle(
    options.settings ?? CONFIGURED,
    status as never,
    connection as never,
    auth as never,
    dialogs as never,
    rpc as never,
    redis as never,
    prisma as never,
    updates as never,
  );
  return {
    lifecycle,
    log,
    states,
    connection,
    dialogs,
    updates,
    redis,
    loseLease: () => leaseLost?.(),
    lastState: () => states.at(-1),
  };
}

describe('TelegramLifecycle', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('stays off without credentials and says why', async () => {
    const { lifecycle, states, connection } = setUp({
      settings: { configured: false, reason: 'TELEGRAM_API_ID is not set' },
    });
    lifecycle.onApplicationBootstrap();
    await lifecycle.onModuleDestroy();
    expect(states).toEqual([
      { state: TelegramConnectionState.UNCONFIGURED, detail: 'TELEGRAM_API_ID is not set' },
    ]);
    expect(connection.acquireLease).not.toHaveBeenCalled();
  });

  it('connects, serves requests, receives updates and refreshes an old chat list', async () => {
    const setup = setUp({ dialogsRefreshedAt: new Date(Date.now() - DIALOGS_STALE_AFTER_MS - 1) });
    setup.lifecycle.onApplicationBootstrap();
    await vi.waitFor(() => expect(setup.log).toContain('refresh dialogs'));
    expect(setup.lastState()).toEqual({ state: TelegramConnectionState.CONNECTED, detail: null });
    expect(setup.log).toEqual(['connect', 'rpc start', 'updates', 'refresh dialogs']);

    await setup.lifecycle.onModuleDestroy();
    // Torn down in order: no new work first, then the client, then the lease.
    expect(setup.log.slice(4)).toEqual(['rpc stop', 'dialogs idle', 'disconnect', 'release lease']);
    expect(setup.redis.close).toHaveBeenCalled();
  });

  it('leaves updates and the chat list alone until the account is logged in', async () => {
    const setup = setUp({ authState: TelegramAuthState.LOGGED_OUT, dialogsRefreshedAt: null });
    setup.lifecycle.onApplicationBootstrap();
    await vi.waitFor(() =>
      expect(setup.lastState()?.state).toBe(TelegramConnectionState.CONNECTED),
    );
    await setup.lifecycle.onModuleDestroy();
    expect(setup.updates.start).not.toHaveBeenCalled();
    expect(setup.dialogs.startRefresh).not.toHaveBeenCalled();
  });

  it('keeps a recent chat list, and stays connected when updates cannot start', async () => {
    const setup = setUp({
      dialogsRefreshedAt: new Date(),
      updatesError: new Error('not ready'),
    });
    setup.lifecycle.onApplicationBootstrap();
    await vi.waitFor(() => expect(setup.updates.start).toHaveBeenCalled());
    await vi.waitFor(() =>
      expect(setup.lastState()?.state).toBe(TelegramConnectionState.CONNECTED),
    );
    await setup.lifecycle.onModuleDestroy();
    expect(setup.dialogs.startRefresh).not.toHaveBeenCalled();
  });

  it('waits on standby while another worker owns the connection, trying again later', async () => {
    const setup = setUp({ lease: [false] });
    setup.lifecycle.onApplicationBootstrap();
    await vi.waitFor(() =>
      expect(setup.lastState()).toEqual({
        state: TelegramConnectionState.STANDBY,
        detail: 'Another worker process owns the Telegram connection',
      }),
    );
    // It pauses (LEASE_RETRY_MS) instead of asking Redis again at once.
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(setup.connection.acquireLease).toHaveBeenCalledTimes(1);
    expect(setup.connection.connect).not.toHaveBeenCalled();
    await setup.lifecycle.onModuleDestroy();
  });

  it('reports a failed connection and cleans up, then reconnects when the lease is lost', async () => {
    const failing = setUp({ connectError: new Error('network down') });
    failing.lifecycle.onApplicationBootstrap();
    await vi.waitFor(() =>
      expect(failing.lastState()).toEqual({
        state: TelegramConnectionState.ERROR,
        detail: 'network down',
      }),
    );
    expect(failing.log).toEqual([
      'connect',
      'rpc stop',
      'dialogs idle',
      'disconnect',
      'release lease',
    ]);
    await failing.lifecycle.onModuleDestroy();

    const losing = setUp();
    losing.lifecycle.onApplicationBootstrap();
    await vi.waitFor(() =>
      expect(losing.lastState()?.state).toBe(TelegramConnectionState.CONNECTED),
    );
    losing.loseLease();
    await vi.waitFor(() =>
      expect(losing.lastState()).toEqual({
        state: TelegramConnectionState.ERROR,
        detail: 'Lost the Telegram owner lease; reconnecting',
      }),
    );
    await vi.waitFor(() => expect(losing.log).toContain('release lease'));
    await losing.lifecycle.onModuleDestroy();
  });
});
