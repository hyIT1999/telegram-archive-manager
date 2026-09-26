import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { PrismaService } from '@tam/database/nest';
import { TelegramAuthState, TelegramConnectionState } from '@tam/shared';
import { errorMessage } from '../common/error-message.js';
import { WorkerStatusService } from '../status/worker-status.service.js';
import { ACCOUNT_KEY, TelegramAuthService } from './telegram-auth.service.js';
import { TelegramConnection } from './telegram-connection.js';
import { TelegramDialogsService } from './telegram-dialogs.service.js';
import { TelegramRedisConnection } from './telegram-redis.connection.js';
import { TelegramRpcServer } from './telegram-rpc.server.js';
import type { TelegramSettings } from './telegram-settings.js';
import { TelegramUpdates } from './telegram-updates.js';
import { TELEGRAM_SETTINGS } from './telegram.tokens.js';

/** How often a standby worker checks whether the owner lease became free. */
export const LEASE_RETRY_MS = 15_000;
/** Pause before reconnecting after an error. */
export const ERROR_RETRY_MS = 30_000;
/** The cached chat list is re-read on connect when it is older than this. */
export const DIALOGS_STALE_AFTER_MS = 6 * 60 * 60_000;

/**
 * Runs the Telegram side of the worker: wait for the owner lease, connect, reconcile the login
 * state, serve RPC requests; on lease loss or error tear down in order and try again. It never
 * blocks the worker's startup — without Telegram the rest of the worker keeps running.
 */
@Injectable()
export class TelegramLifecycle implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(TelegramLifecycle.name);
  private readonly stopping = new AbortController();
  private loop: Promise<void> | undefined;

  constructor(
    @Inject(TELEGRAM_SETTINGS) private readonly settings: TelegramSettings,
    private readonly status: WorkerStatusService,
    private readonly connection: TelegramConnection,
    private readonly auth: TelegramAuthService,
    private readonly dialogs: TelegramDialogsService,
    private readonly rpc: TelegramRpcServer,
    private readonly redis: TelegramRedisConnection,
    private readonly prisma: PrismaService,
    private readonly updates: TelegramUpdates,
  ) {
    if (settings.configured) {
      status.setTelegram(TelegramConnectionState.STANDBY, 'Starting');
    } else {
      status.setTelegram(TelegramConnectionState.UNCONFIGURED, settings.reason);
    }
  }

  onApplicationBootstrap(): void {
    if (!this.settings.configured) {
      this.logger.warn(`Telegram is disabled: ${this.settings.reason}`);
      return;
    }
    this.loop = this.run();
  }

  async onModuleDestroy(): Promise<void> {
    this.stopping.abort();
    await this.loop;
    await this.redis.close();
  }

  private async run(): Promise<void> {
    const signal = this.stopping.signal;
    while (!signal.aborted) {
      let retryAfterMs = ERROR_RETRY_MS;
      try {
        if (!(await this.connection.acquireLease())) {
          this.status.setTelegram(
            TelegramConnectionState.STANDBY,
            'Another worker process owns the Telegram connection',
          );
          retryAfterMs = LEASE_RETRY_MS;
          continue;
        }
        const leaseLost = new Promise<void>((resolve) => this.connection.onLeaseLost(resolve));
        this.status.setTelegram(TelegramConnectionState.CONNECTING);
        await this.connection.connect();
        const state = await this.auth.initialize();
        await this.rpc.start();
        this.status.setTelegram(TelegramConnectionState.CONNECTED);
        this.logger.log(`Connected to Telegram (login state: ${state})`);
        if (state === TelegramAuthState.READY) {
          await this.startUpdates();
          await this.refreshStaleDialogs();
        }

        await Promise.race([leaseLost, aborted(signal)]);
        if (!signal.aborted) {
          this.status.setTelegram(
            TelegramConnectionState.ERROR,
            'Lost the Telegram owner lease; reconnecting',
          );
          retryAfterMs = LEASE_RETRY_MS;
        }
      } catch (error) {
        if (!signal.aborted) {
          this.logger.error(`Telegram connection failed: ${errorMessage(error)}`);
          this.status.setTelegram(TelegramConnectionState.ERROR, errorMessage(error));
        }
      } finally {
        await this.teardown();
      }
      await sleep(retryAfterMs, signal);
    }
  }

  /** RPC first (no new work), then the client, then the lease — never the other way round. */
  private async teardown(): Promise<void> {
    await this.rpc.stop();
    await this.dialogs.idle();
    await this.connection.disconnect();
    await this.connection.releaseLease();
  }

  /**
   * A restored session does not receive updates by itself (only a sign-in starts them). A failure
   * is not fatal: the sync scheduler asks again on every round.
   */
  private async startUpdates(): Promise<void> {
    await this.updates.start().catch((error: unknown) => {
      this.logger.warn(`Could not start receiving Telegram updates: ${errorMessage(error)}`);
    });
  }

  private async refreshStaleDialogs(): Promise<void> {
    const account = await this.prisma.telegramAccount.findUnique({
      where: { accountKey: ACCOUNT_KEY },
    });
    const refreshedAt = account?.dialogsRefreshedAt?.getTime() ?? 0;
    if (Date.now() - refreshedAt > DIALOGS_STALE_AFTER_MS) {
      await this.dialogs.startRefresh().catch((error: unknown) => {
        this.logger.warn(`Could not start the chat list refresh: ${errorMessage(error)}`);
      });
    }
  }
}

function aborted(signal: AbortSignal): Promise<void> {
  return signal.aborted
    ? Promise.resolve()
    : new Promise((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }));
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    signal.addEventListener('abort', done, { once: true });
    function done(): void {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    }
  });
}
