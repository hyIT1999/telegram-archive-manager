import { hostname } from 'node:os';
import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { REDIS_KEYS } from '@tam/shared';
import { Redis } from 'ioredis';
import { errorMessage } from '../common/error-message.js';
import type { WorkerEnv } from '../config/env.schema.js';
import { buildHeartbeat, heartbeatTtlMs } from './heartbeat.js';

/** Deletes the key only while it still holds our last beat, so a newer worker's beat survives. */
const DELETE_IF_UNCHANGED = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0`;

/**
 * Writes REDIS_KEYS.workerHeartbeat every WORKER_HEARTBEAT_INTERVAL_MS with a TTL of three
 * intervals, from application bootstrap until shutdown. It owns its Redis connection so beats
 * never queue behind BullMQ traffic.
 */
@Injectable()
export class HeartbeatService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(HeartbeatService.name);
  private readonly redis: Redis;
  private readonly intervalMs: number;
  private readonly host = hostname();
  private readonly startedAt = new Date();
  private timer: NodeJS.Timeout | undefined;
  private inFlight: Promise<void> | undefined;
  private lastPayload: string | undefined;
  private lastConnectionError: Error | undefined;
  private failing = false;

  constructor(config: ConfigService<WorkerEnv, true>) {
    this.intervalMs = config.get('WORKER_HEARTBEAT_INTERVAL_MS', { infer: true });
    this.redis = new Redis(config.get('REDIS_URL', { infer: true }), {
      connectionName: 'tam-worker-heartbeat',
      lazyConnect: true,
      // A beat that cannot be written now is worthless later: fail fast, the next tick retries.
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      // Bounds each command, so a hung Redis cannot stall a beat or the shutdown past one interval.
      commandTimeout: this.intervalMs,
    });
    // Failed beats are reported below; without a listener ioredis would print every error raw.
    this.redis.on('error', (error: Error) => {
      this.lastConnectionError = error;
      this.logger.debug(`Redis: ${error.message}`);
    });
  }

  /** The first beat is written before bootstrap completes, so an unreachable Redis fails startup. */
  async onApplicationBootstrap(): Promise<void> {
    await this.redis.connect().catch((error: unknown) => {
      // connect() only reports "Connection is closed"; the socket error says why.
      throw new Error(
        `Heartbeat cannot reach Redis: ${errorMessage(this.lastConnectionError ?? error)}`,
      );
    });
    await this.beat();
    this.timer = setInterval(() => this.tick(), this.intervalMs);
    this.timer.unref();
  }

  /**
   * Runs at the start of shutdown (root-module onModuleDestroy), so the api stops counting on this
   * worker while its jobs are still draining.
   */
  async onModuleDestroy(): Promise<void> {
    clearInterval(this.timer);
    await this.inFlight; // a SET still in flight must not land after the DEL
    try {
      if (this.lastPayload !== undefined) {
        await this.redis.eval(DELETE_IF_UNCHANGED, 1, REDIS_KEYS.workerHeartbeat, this.lastPayload);
      }
    } catch (error) {
      this.logger.warn(
        `Could not delete the heartbeat key (it will expire): ${errorMessage(error)}`,
      );
    }
    await this.redis.quit().catch(() => this.redis.disconnect());
  }

  private tick(): void {
    if (this.inFlight) {
      return; // the previous beat has not finished yet
    }
    this.inFlight = this.beat()
      .catch((error: unknown) => this.reportFailure(error))
      .finally(() => {
        this.inFlight = undefined;
      });
  }

  private async beat(): Promise<void> {
    const payload = JSON.stringify(
      buildHeartbeat({
        now: new Date(),
        startedAt: this.startedAt,
        pid: process.pid,
        host: this.host,
      }),
    );
    await this.redis.set(
      REDIS_KEYS.workerHeartbeat,
      payload,
      'PX',
      heartbeatTtlMs(this.intervalMs),
    );
    this.lastPayload = payload;
    if (this.failing) {
      this.failing = false;
      this.logger.log('Heartbeat restored');
    }
  }

  /** Logs once per outage instead of on every tick. */
  private reportFailure(error: unknown): void {
    if (!this.failing) {
      this.failing = true;
      this.logger.warn(
        `Heartbeat write failed, retrying every ${this.intervalMs} ms: ${errorMessage(error)}`,
      );
    }
  }
}
