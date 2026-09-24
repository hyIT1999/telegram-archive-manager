import {
  REDIS_KEYS,
  type TelegramRpcError,
  type TelegramRpcRequest,
  type WorkerHeartbeat,
  telegramRpcChannels,
  telegramRpcRequestSchema,
} from '@tam/shared';
import { Redis } from 'ioredis';
import { inject } from 'vitest';

/** What the fake worker does with a request: answer ok, answer an error, or stay silent. */
export type FakeWorkerOutcome = { ok: true } | { ok: false; error: TelegramRpcError } | 'silent';

/**
 * Plays the worker's side of the Telegram RPC in the api e2e tests: it keeps a heartbeat in the
 * test Redis database and answers requests published on the RPC channel.
 */
export class FakeWorker {
  private readonly commands = new Redis(inject('redisUrl'), { lazyConnect: true });
  private subscriber: Redis | undefined;
  readonly requests: TelegramRpcRequest[] = [];
  handler: (request: TelegramRpcRequest) => Promise<FakeWorkerOutcome> | FakeWorkerOutcome = () => ({
    ok: true,
  });

  async connect(): Promise<void> {
    await this.commands.connect();
  }

  async setHeartbeat(telegram?: WorkerHeartbeat['telegram']): Promise<void> {
    const now = new Date().toISOString();
    const beat: WorkerHeartbeat = { ts: now, pid: 1, host: 'fake-worker', startedAt: now, ...(telegram ? { telegram } : {}) };
    await this.commands.set(REDIS_KEYS.workerHeartbeat, JSON.stringify(beat), 'PX', 60_000);
  }

  async setRefreshing(refreshing: boolean): Promise<void> {
    if (refreshing) {
      await this.commands.set(REDIS_KEYS.telegramDialogsRefreshing, '1', 'PX', 60_000);
    } else {
      await this.commands.del(REDIS_KEYS.telegramDialogsRefreshing);
    }
  }

  /** Subscribes to the RPC channel, like a worker that owns the Telegram connection. */
  async listen(): Promise<void> {
    const subscriber = new Redis(inject('redisUrl'), { lazyConnect: true });
    subscriber.on('message', (_channel: string, raw: string) => void this.answer(raw));
    await subscriber.connect();
    await subscriber.subscribe(telegramRpcChannels(process.env['BULLMQ_PREFIX'] as string).request);
    this.subscriber = subscriber;
  }

  async stopListening(): Promise<void> {
    const subscriber = this.subscriber;
    this.subscriber = undefined;
    await subscriber?.quit();
  }

  async reset(): Promise<void> {
    await this.stopListening();
    this.requests.length = 0;
    this.handler = () => ({ ok: true });
    await this.commands.del(REDIS_KEYS.workerHeartbeat, REDIS_KEYS.telegramDialogsRefreshing);
  }

  async close(): Promise<void> {
    await this.reset();
    await this.commands.quit();
  }

  private async answer(raw: string): Promise<void> {
    const request = telegramRpcRequestSchema.parse(JSON.parse(raw));
    this.requests.push(request);
    const outcome = await this.handler(request);
    if (outcome === 'silent') {
      return;
    }
    await this.commands.publish(request.replyTo, JSON.stringify({ id: request.id, ...outcome }));
  }
}
