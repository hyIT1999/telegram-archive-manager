import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import type { WorkerEnv } from '../config/env.schema.js';

/**
 * Redis command connection of the Telegram module (owner lease, refresh flag, RPC replies).
 * TelegramLifecycle closes it after its own teardown, which still needs it to release the lease.
 */
@Injectable()
export class TelegramRedisConnection {
  private readonly logger = new Logger(TelegramRedisConnection.name);
  readonly client: Redis;

  constructor(config: ConfigService<WorkerEnv, true>) {
    this.client = new Redis(config.get('REDIS_URL', { infer: true }), {
      connectionName: 'tam-worker-telegram',
      lazyConnect: true,
      maxRetriesPerRequest: 3,
    });
    this.client.on('error', (error: Error) => this.logger.debug(`Redis: ${error.message}`));
  }

  async close(): Promise<void> {
    await this.client.quit().catch(() => this.client.disconnect());
  }
}
