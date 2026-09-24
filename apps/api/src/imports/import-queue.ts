import { Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  IMPORT_RUN_JOB_NAME,
  type ImportJobData,
  QUEUES,
  importRunJobOptions,
  jobIds,
} from '@tam/shared';
import { Queue } from 'bullmq';
import type { Env } from '../config/env.js';

/** A request never waits longer than this for Redis; the worker's reconciler catches up. */
export const QUEUE_TIMEOUT_MS = 3_000;

/**
 * Hands import runs to the worker through BullMQ. The import job row in PostgreSQL is the record
 * of truth and is written first; the queue only wakes the worker. So a Redis outage never fails
 * a request: the run is added by the worker's reconciler (at startup and every minute) instead.
 */
@Injectable()
export class ImportQueue implements OnApplicationShutdown {
  private readonly logger = new Logger(ImportQueue.name);
  private readonly queue: Queue<ImportJobData>;

  constructor(config: ConfigService<Env, true>) {
    this.queue = new Queue<ImportJobData>(QUEUES.telegramImport, {
      prefix: config.get('BULLMQ_PREFIX', { infer: true }),
      connection: {
        url: config.get('REDIS_URL', { infer: true }),
        connectionName: 'tam-api-queue',
        connectTimeout: 5_000,
        maxRetriesPerRequest: 2,
      },
    });
    // Outages are reported by the api's main Redis connection; keep these quiet.
    this.queue.on('error', (error: Error) => this.logger.debug(`Queue: ${error.message}`));
  }

  /** Queues a run of the job; false when Redis did not take it in time. */
  async enqueue(importJobId: string, runSeq: number): Promise<boolean> {
    try {
      await withTimeout(
        this.queue.add(
          IMPORT_RUN_JOB_NAME,
          { importJobId, runSeq },
          importRunJobOptions(importJobId, runSeq),
        ),
      );
      return true;
    } catch (error) {
      this.logger.warn(
        `Import job ${importJobId} is saved but not queued yet (${error instanceof Error ? error.message : String(error)}); the worker will queue it`,
      );
      return false;
    }
  }

  /**
   * Drops a run that has not started, after a pause or cancel. Best effort: a run that is already
   * running (locked) or unreachable ends by itself at its next page, when it finds the job
   * paused or cancelled.
   */
  async discard(importJobId: string, runSeq: number): Promise<void> {
    try {
      await withTimeout(this.queue.remove(jobIds.importRun(importJobId, runSeq)));
    } catch {
      // See above: the run notices the new status on its own.
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.queue.close().catch(() => undefined);
  }
}

function withTimeout<T>(operation: Promise<T>, ms = QUEUE_TIMEOUT_MS): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Redis did not answer within ${ms} ms`)), ms);
    timer.unref();
  });
  return Promise.race([operation, timeout]).finally(() => clearTimeout(timer));
}
