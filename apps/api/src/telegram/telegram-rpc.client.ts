import { randomUUID } from 'node:crypto';
import {
  GatewayTimeoutException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiErrorCode,
  REDIS_KEYS,
  TelegramConnectionState,
  TelegramErrorCode,
  type TelegramRpcCall,
  type TelegramRpcError,
  type WorkerHeartbeat,
  type TelegramRpcChannels,
  telegramRpcChannels,
  telegramRpcReplySchema,
  workerHeartbeatSchema,
} from '@tam/shared';
import { Redis } from 'ioredis';
import type { Env } from '../config/env.js';
import { REDIS_CLIENT } from '../redis/redis.constants.js';

/** HTTP status for each Telegram outcome; anything unknown is a 502 (bad gateway). */
const STATUS_BY_CODE: Readonly<Record<string, HttpStatus>> = {
  [TelegramErrorCode.INVALID_LOGIN_STATE]: HttpStatus.CONFLICT,
  [TelegramErrorCode.TELEGRAM_NOT_READY]: HttpStatus.CONFLICT,
  [TelegramErrorCode.SESSION_REVOKED]: HttpStatus.CONFLICT,
  [TelegramErrorCode.PHONE_NUMBER_INVALID]: HttpStatus.UNPROCESSABLE_ENTITY,
  [TelegramErrorCode.PHONE_NUMBER_BANNED]: HttpStatus.UNPROCESSABLE_ENTITY,
  [TelegramErrorCode.PHONE_CODE_INVALID]: HttpStatus.UNPROCESSABLE_ENTITY,
  [TelegramErrorCode.PHONE_CODE_EXPIRED]: HttpStatus.UNPROCESSABLE_ENTITY,
  [TelegramErrorCode.PASSWORD_INVALID]: HttpStatus.UNPROCESSABLE_ENTITY,
  [TelegramErrorCode.SIGN_UP_REQUIRED]: HttpStatus.UNPROCESSABLE_ENTITY,
  [TelegramErrorCode.PAYMENT_REQUIRED]: HttpStatus.UNPROCESSABLE_ENTITY,
  [TelegramErrorCode.EMAIL_REQUIRED]: HttpStatus.UNPROCESSABLE_ENTITY,
  [TelegramErrorCode.FLOOD_WAIT]: HttpStatus.TOO_MANY_REQUESTS,
  [TelegramErrorCode.CHAT_PROTECTED]: HttpStatus.UNPROCESSABLE_ENTITY,
  [TelegramErrorCode.CHAT_UNAVAILABLE]: HttpStatus.UNPROCESSABLE_ENTITY,
  [TelegramErrorCode.NOT_A_FORUM]: HttpStatus.UNPROCESSABLE_ENTITY,
  [ApiErrorCode.TELEGRAM_UNAVAILABLE]: HttpStatus.SERVICE_UNAVAILABLE,
  [ApiErrorCode.NOT_FOUND]: HttpStatus.NOT_FOUND,
};

interface PendingCall {
  settle: (outcome: TelegramRpcError | null) => void;
  timer: NodeJS.Timeout;
}

const TIMED_OUT: TelegramRpcError = { code: ApiErrorCode.TELEGRAM_TIMEOUT, message: 'timeout' };

/**
 * Calls the worker that owns the Telegram connection over Redis pub/sub (see telegram-rpc.ts in
 * @tam/shared for why this is not a queue). Replies arrive on this process' own channel.
 */
@Injectable()
export class TelegramRpcClient implements OnModuleDestroy {
  private readonly logger = new Logger(TelegramRpcClient.name);
  private readonly channels: TelegramRpcChannels;
  private readonly replyChannel: string;
  private readonly pending = new Map<string, PendingCall>();
  private readonly timeoutMs: number;
  private subscriber: Redis | undefined;
  private subscribed: Promise<void> | undefined;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly config: ConfigService<Env, true>,
  ) {
    this.timeoutMs = config.get('TELEGRAM_RPC_TIMEOUT_MS', { infer: true });
    this.channels = telegramRpcChannels(config.get('BULLMQ_PREFIX', { infer: true }));
    this.replyChannel = `${this.channels.replyPrefix}${randomUUID()}`;
  }

  /** Resolves when the worker completed the call; throws an HttpException otherwise. */
  async call(call: TelegramRpcCall): Promise<void> {
    await this.ensureSubscribed();
    const heartbeat = await this.readHeartbeat();
    if (!heartbeat) {
      throw new ServiceUnavailableException({
        code: ApiErrorCode.WORKER_UNAVAILABLE,
        message: 'The background worker is not running. Start it and try again.',
      });
    }

    const id = randomUUID();
    const outcome = new Promise<TelegramRpcError | null>((resolve) => {
      const timer = setTimeout(() => this.settle(id, TIMED_OUT), this.timeoutMs);
      this.pending.set(id, { settle: resolve, timer });
    });
    let receivers: number;
    try {
      receivers = await this.redis.publish(
        this.channels.request,
        JSON.stringify({ id, replyTo: this.replyChannel, deadline: Date.now() + this.timeoutMs, call }),
      );
    } catch {
      this.settle(id, null);
      throw new ServiceUnavailableException({
        code: ApiErrorCode.WORKER_UNAVAILABLE,
        message: 'Redis is not reachable, so the worker cannot be contacted.',
      });
    }
    if (receivers === 0) {
      this.settle(id, null);
      throw new ServiceUnavailableException({
        code: ApiErrorCode.TELEGRAM_UNAVAILABLE,
        message: unavailableMessage(heartbeat),
      });
    }

    const error = await outcome;
    if (error === TIMED_OUT) {
      throw new GatewayTimeoutException({
        code: ApiErrorCode.TELEGRAM_TIMEOUT,
        message: 'Telegram did not answer in time. Try again.',
      });
    }
    if (error) {
      throw new HttpException(
        {
          code: error.code,
          message: error.message,
          ...(error.retryAfterSeconds === undefined
            ? {}
            : { details: { retryAfterSeconds: error.retryAfterSeconds } }),
        },
        STATUS_BY_CODE[error.code] ?? HttpStatus.BAD_GATEWAY,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    for (const id of [...this.pending.keys()]) {
      this.settle(id, TIMED_OUT);
    }
    const subscriber = this.subscriber;
    this.subscriber = undefined;
    this.subscribed = undefined;
    if (subscriber) {
      await subscriber.quit().catch(() => subscriber.disconnect());
    }
  }

  /** The heartbeat the worker keeps in Redis, or null when it is not running. */
  async readHeartbeat(): Promise<WorkerHeartbeat | null> {
    try {
      const raw = await this.redis.get(REDIS_KEYS.workerHeartbeat);
      if (raw === null) {
        return null;
      }
      const parsed = workerHeartbeatSchema.safeParse(JSON.parse(raw));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }

  /** Subscribes on first use (the api must boot even while Redis is down). */
  private ensureSubscribed(): Promise<void> {
    this.subscribed ??= this.subscribe().catch((error: unknown) => {
      this.subscribed = undefined;
      this.logger.warn(`Cannot listen for Telegram replies: ${error instanceof Error ? error.message : String(error)}`);
      throw new ServiceUnavailableException({
        code: ApiErrorCode.WORKER_UNAVAILABLE,
        message: 'Redis is not reachable, so the worker cannot be contacted.',
      });
    });
    return this.subscribed;
  }

  private async subscribe(): Promise<void> {
    const subscriber = new Redis(this.config.get('REDIS_URL', { infer: true }), {
      connectionName: 'tam-api-telegram-rpc',
      lazyConnect: true,
      connectTimeout: 5_000,
      maxRetriesPerRequest: 2,
    });
    subscriber.on('error', (error: Error) => this.logger.debug(`Redis: ${error.message}`));
    subscriber.on('message', (_channel: string, raw: string) => this.onReply(raw));
    try {
      await subscriber.connect();
      await subscriber.subscribe(this.replyChannel);
    } catch (error) {
      subscriber.disconnect();
      throw error;
    }
    this.subscriber = subscriber;
  }

  private onReply(raw: string): void {
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      return;
    }
    const parsed = telegramRpcReplySchema.safeParse(json);
    if (!parsed.success) {
      this.logger.warn('Ignoring a malformed Telegram reply');
      return;
    }
    const reply = parsed.data;
    this.settle(reply.id, reply.ok ? null : reply.error);
  }

  private settle(id: string, outcome: TelegramRpcError | null): void {
    const call = this.pending.get(id);
    if (!call) {
      return; // late reply after a timeout
    }
    this.pending.delete(id);
    clearTimeout(call.timer);
    call.settle(outcome);
  }
}

function unavailableMessage(heartbeat: WorkerHeartbeat): string {
  const telegram = heartbeat.telegram;
  switch (telegram?.state) {
    case TelegramConnectionState.UNCONFIGURED:
      return `Telegram is not configured on the worker (${telegram.detail ?? 'missing settings'}). See README §4.`;
    case TelegramConnectionState.STANDBY:
      return 'Another worker process holds the Telegram connection; this one is on standby.';
    case TelegramConnectionState.ERROR:
      return `The worker cannot reach Telegram: ${telegram.detail ?? 'unknown error'}. It retries automatically.`;
    default:
      return 'The worker is connecting to Telegram. Try again in a moment.';
  }
}
