import { hostname } from 'node:os';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { SecretBox } from '@tam/crypto';
import { REDIS_KEYS } from '@tam/shared';
import {
  MtcuteTelegramAdapter,
  type SessionStorage,
  createMtcuteClient,
  createSessionStorage,
} from '@tam/telegram';
import type { Redis } from 'ioredis';
import { errorMessage } from '../common/error-message.js';
import type { WorkerEnv } from '../config/env.schema.js';
import { RedisLease } from './redis-lease.js';
import { TelegramCooldown } from './telegram-cooldown.js';
import { APP_VERSION, type TelegramSettings, mtcuteLogLevel } from './telegram-settings.js';
import { TelegramUpdates } from './telegram-updates.js';
import {
  SECRET_BOX,
  TELEGRAM_REDIS,
  TELEGRAM_SETTINGS,
  type TelegramApi,
  type TelegramApiProvider,
  TelegramUnavailableError,
} from './telegram.tokens.js';

export const LEASE_TTL_MS = 30_000;
export const LEASE_RENEW_INTERVAL_MS = 10_000;

type MtcuteClient = ReturnType<typeof createMtcuteClient>;

/**
 * Owns the single Telegram connection of the deployment: first the owner lease in Redis, then the
 * mtcute client with its encrypted session in TELEGRAM_SESSION_DATABASE_URL.
 */
@Injectable()
export class TelegramConnection implements TelegramApiProvider {
  private readonly logger = new Logger(TelegramConnection.name);
  private lease: RedisLease | undefined;
  private renewTimer: NodeJS.Timeout | undefined;
  private client: MtcuteClient | undefined;
  private session: SessionStorage | undefined;
  private adapter: MtcuteTelegramAdapter | undefined;
  private leaseLostListener: (() => void) | undefined;
  /** Whether the current client was asked to receive updates (logged once per client). */
  private receiving = false;

  constructor(
    @Inject(TELEGRAM_SETTINGS) private readonly settings: TelegramSettings,
    @Inject(SECRET_BOX) private readonly box: SecretBox | null,
    @Inject(TELEGRAM_REDIS) private readonly redis: Redis,
    private readonly config: ConfigService<WorkerEnv, true>,
    private readonly cooldown: TelegramCooldown,
    private readonly updates: TelegramUpdates,
  ) {}

  get api(): TelegramApi {
    if (!this.adapter) {
      throw new TelegramUnavailableError();
    }
    return this.adapter;
  }

  /** Called once if the lease cannot be renewed (another process may take over). */
  onLeaseLost(listener: () => void): void {
    this.leaseLostListener = listener;
  }

  /** Takes the owner lease; false while another worker process holds it. */
  async acquireLease(): Promise<boolean> {
    this.lease ??= new RedisLease(
      this.redis,
      REDIS_KEYS.telegramOwner,
      LEASE_TTL_MS,
      `${hostname()}:${process.pid}`,
    );
    if (!(await this.lease.tryAcquire())) {
      return false;
    }
    this.renewTimer = setInterval(() => void this.renewLease(), LEASE_RENEW_INTERVAL_MS);
    this.renewTimer.unref();
    return true;
  }

  async connect(): Promise<void> {
    if (!this.settings.configured || !this.box) {
      throw new Error('Telegram is not configured');
    }
    this.session = createSessionStorage({
      connectionString: this.settings.sessionDatabaseUrl,
      box: this.box,
    });
    this.client = createMtcuteClient({
      apiId: this.settings.apiId,
      apiHash: this.settings.apiHash,
      storage: this.session.storage,
      appVersion: APP_VERSION,
      logLevel: mtcuteLogLevel(this.config.get('LOG_LEVEL', { infer: true })),
      onFloodWait: (method, seconds) => {
        this.cooldown.note(seconds);
        this.logger.warn(`Telegram rate limit on ${method}: waiting ${seconds} s`);
      },
    });
    await this.client.connect();
    const adapter = new MtcuteTelegramAdapter(this.client);
    // Before any sign-in: signing in starts the client's update loop by itself.
    adapter.onUpdate((event) => this.updates.emit(event));
    this.adapter = adapter;
    this.receiving = false;
    this.updates.attach(() => this.startUpdates(adapter));
  }

  /** Destroys the client and closes the session database; safe to call in any state. */
  async disconnect(): Promise<void> {
    this.updates.attach(undefined);
    this.adapter = undefined;
    const client = this.client;
    const session = this.session;
    this.client = undefined;
    this.session = undefined;
    try {
      await client?.destroy();
    } catch (error) {
      this.logger.warn(`Closing the Telegram client failed: ${errorMessage(error)}`);
    }
    try {
      await session?.close();
    } catch (error) {
      this.logger.warn(`Closing the session database failed: ${errorMessage(error)}`);
    }
  }

  /** Receives Telegram's updates on this client from now on; the account must be logged in. */
  private async startUpdates(adapter: MtcuteTelegramAdapter): Promise<void> {
    if (this.adapter !== adapter) {
      return;
    }
    await adapter.startUpdates();
    if (!this.receiving && this.adapter === adapter) {
      this.receiving = true;
      this.logger.log('Receiving updates from Telegram');
    }
  }

  async releaseLease(): Promise<void> {
    clearInterval(this.renewTimer);
    this.renewTimer = undefined;
    try {
      await this.lease?.release();
    } catch (error) {
      this.logger.warn(
        `Releasing the Telegram owner lease failed (it will expire): ${errorMessage(error)}`,
      );
    }
  }

  private async renewLease(): Promise<void> {
    let renewed: boolean;
    try {
      renewed = (await this.lease?.renew()) ?? false;
    } catch (error) {
      // Redis briefly unreachable: the lease survives until its TTL, so try again next tick.
      this.logger.warn(`Renewing the Telegram owner lease failed: ${errorMessage(error)}`);
      return;
    }
    if (!renewed) {
      clearInterval(this.renewTimer);
      this.renewTimer = undefined;
      this.logger.error('Lost the Telegram owner lease; disconnecting from Telegram');
      this.leaseLostListener?.();
    }
  }
}
