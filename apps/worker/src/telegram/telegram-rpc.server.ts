import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  TelegramAuthState,
  TelegramErrorCode,
  type TelegramRpcCall,
  type TelegramRpcError,
  type TelegramRpcReply,
  type TelegramRpcChannels,
  telegramRpcChannels,
  telegramRpcRequestSchema,
} from '@tam/shared';
import { FloodWaitError, TelegramError } from '@tam/telegram';
import { Redis } from 'ioredis';
import { errorMessage } from '../common/error-message.js';
import type { WorkerEnv } from '../config/env.schema.js';
import { ForumTopicsService } from './forum-topics.service.js';
import { TelegramAuthService } from './telegram-auth.service.js';
import { TelegramDialogsService } from './telegram-dialogs.service.js';
import { TELEGRAM_REDIS } from './telegram.tokens.js';

/** How long shutdown waits for requests that are being handled. */
const DRAIN_TIMEOUT_MS = 10_000;

/**
 * Serves the api's Telegram requests (login steps, chat list and forum topic refreshes) over Redis pub/sub while
 * this process owns the Telegram connection. Payloads carry login codes and passwords: they are
 * validated, never logged and never persisted.
 */
@Injectable()
export class TelegramRpcServer {
  private readonly logger = new Logger(TelegramRpcServer.name);
  private subscriber: Redis | undefined;
  private readonly inFlight = new Set<Promise<void>>();
  private readonly channels: TelegramRpcChannels;

  constructor(
    private readonly config: ConfigService<WorkerEnv, true>,
    @Inject(TELEGRAM_REDIS) private readonly publisher: Redis,
    private readonly auth: TelegramAuthService,
    private readonly dialogs: TelegramDialogsService,
    private readonly topics: ForumTopicsService,
  ) {
    this.channels = telegramRpcChannels(config.get('BULLMQ_PREFIX', { infer: true }));
  }

  async start(): Promise<void> {
    if (this.subscriber) {
      return;
    }
    const subscriber = new Redis(this.config.get('REDIS_URL', { infer: true }), {
      connectionName: 'tam-worker-telegram-rpc',
      lazyConnect: true,
    });
    subscriber.on('error', (error: Error) => this.logger.debug(`Redis: ${error.message}`));
    subscriber.on('message', (_channel: string, raw: string) => this.track(this.handle(raw)));
    await subscriber.connect();
    await subscriber.subscribe(this.channels.request);
    this.subscriber = subscriber;
  }

  /** Stops receiving requests and lets the ones in progress finish (bounded). */
  async stop(): Promise<void> {
    const subscriber = this.subscriber;
    this.subscriber = undefined;
    if (subscriber) {
      await subscriber.unsubscribe().catch(() => undefined);
      await subscriber.quit().catch(() => subscriber.disconnect());
    }
    await Promise.race([
      Promise.allSettled([...this.inFlight]),
      new Promise((resolve) => setTimeout(resolve, DRAIN_TIMEOUT_MS).unref()),
    ]);
  }

  /** Resolves when every request received so far has been answered (tests). */
  async drained(): Promise<void> {
    await Promise.allSettled([...this.inFlight]);
  }

  private track(work: Promise<void>): void {
    this.inFlight.add(work);
    void work.finally(() => this.inFlight.delete(work));
  }

  private async handle(raw: string): Promise<void> {
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      this.logger.warn('Ignoring a Telegram RPC request that is not JSON');
      return;
    }
    const parsed = telegramRpcRequestSchema.safeParse(json);
    if (!parsed.success) {
      this.logger.warn('Ignoring a malformed Telegram RPC request');
      return;
    }
    const request = parsed.data;
    if (!request.replyTo.startsWith(this.channels.replyPrefix)) {
      this.logger.warn('Ignoring a Telegram RPC request that expects its reply elsewhere');
      return;
    }
    if (Date.now() > request.deadline) {
      this.logger.debug(`Skipping expired Telegram request ${request.call.method}`);
      return;
    }

    let reply: TelegramRpcReply;
    try {
      await this.dispatch(request.call);
      reply = { id: request.id, ok: true };
    } catch (error) {
      reply = { id: request.id, ok: false, error: this.toRpcError(request.call.method, error) };
    }
    try {
      await this.publisher.publish(request.replyTo, JSON.stringify(reply));
    } catch (error) {
      this.logger.warn(`Could not answer a Telegram request: ${errorMessage(error)}`);
    }
  }

  private async dispatch(call: TelegramRpcCall): Promise<void> {
    switch (call.method) {
      case 'auth.phone':
        return this.afterLogin(await this.auth.submitPhone(call.phoneNumber));
      case 'auth.code':
        return this.afterLogin(await this.auth.submitCode(call.code));
      case 'auth.resend':
        return this.afterLogin(await this.auth.resendCode());
      case 'auth.password':
        return this.afterLogin(await this.auth.submitPassword(call.password));
      case 'auth.logout':
        await this.auth.logout();
        return;
      case 'dialogs.refresh':
        await this.dialogs.startRefresh();
        return;
      case 'topics.refresh':
        // Answers once the topics are stored, so the api's next read shows them.
        await this.topics.refresh(call.channelId);
        return;
    }
  }

  /**
   * Fetches the chat list right after a successful login, so step 2 of the wizard has data. Waits
   * only until the refresh is flagged (not for the refresh itself), so the api's next read of the
   * chat list already shows it in progress.
   */
  private async afterLogin(state: TelegramAuthState): Promise<void> {
    if (state === TelegramAuthState.READY) {
      await this.dialogs.startRefresh().catch((error: unknown) => {
        this.logger.warn(`Could not start the chat list refresh: ${errorMessage(error)}`);
      });
    }
  }

  private toRpcError(method: string, error: unknown): TelegramRpcError {
    if (error instanceof FloodWaitError) {
      return { code: error.code, message: error.message, retryAfterSeconds: error.seconds };
    }
    if (error instanceof TelegramError) {
      return { code: error.code, message: error.message };
    }
    this.logger.error(
      `Telegram request ${method} failed: ${errorMessage(error)}`,
      error instanceof Error ? error.stack : undefined,
    );
    return {
      code: TelegramErrorCode.TELEGRAM_ERROR,
      message: 'The worker could not complete the Telegram request',
    };
  }
}
