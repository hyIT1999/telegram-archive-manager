import { Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  IMPORT_RUN_JOB_NAME,
  type ImportJobData,
  type ImportJobType,
  QUEUES,
  importRunJobOptions,
  jobIds,
  queueForJobType,
} from '@tam/shared';
import { Queue } from 'bullmq';
import type { Env } from '../config/env.js';

/** A request never waits longer than this for Redis; the worker's reconciler catches up. */
export const QUEUE_TIMEOUT_MS = 3_000;

/** What routing a run needs to know about its job. */
export interface QueuedJob {
  id: string;
  type: ImportJobType;
}

type RunQueueName = typeof QUEUES.telegramImport | typeof QUEUES.telegramSync;

/**
 * Hands import and sync runs to the worker through BullMQ (each type has its queue). The job row
 * in PostgreSQL is the record of truth and is written first; the queue only wakes the worker. So
 * a Redis outage never fails a request: the run is added by the worker's reconciler (at startup
 * and every minute) instead.
 */
@Injectable()
export class ImportQueue implements OnApplicationShutdown {
  private readonly logger = new Logger(ImportQueue.name);
  private readonly queues: Record<RunQueueName, Queue<ImportJobData>>;

  constructor(config: ConfigService<Env, true>) {
    const create = (name: RunQueueName) => {
      const queue = new Queue<ImportJobData>(name, {
        prefix: config.get('BULLMQ_PREFIX', { infer: true }),
        connection: {
          url: config.get('REDIS_URL', { infer: true }),
          connectionName: 'tam-api-queue',
          connectTimeout: 5_000,
          maxRetriesPerRequest: 2,
        },
      });
      // Outages are reported by the api's main Redis connection; keep these quiet.
      queue.on('error', (error: Error) => this.logger.debug(`Queue ${name}: ${error.message}`));
      return queue;
    };
    this.queues = {
      [QUEUES.telegramImport]: create(QUEUES.telegramImport),
      [QUEUES.telegramSync]: create(QUEUES.telegramSync),
    };
  }

  /** Queues a run of the job; false when Redis did not take it in time. */
  async enqueue(job: QueuedJob, runSeq: number): Promise<boolean> {
    try {
      await withTimeout(
        this.queueOf(job).add(
          IMPORT_RUN_JOB_NAME,
          { importJobId: job.id, runSeq },
          importRunJobOptions(job.id, runSeq),
        ),
      );
      return true;
    } catch (error) {
      this.logger.warn(
        `Job ${job.id} is saved but not queued yet (${error instanceof Error ? error.message : String(error)}); the worker will queue it`,
      );
      return false;
    }
  }

  /**
   * Drops a run that has not started, after a pause or cancel. Best effort: a run that is already
   * running (locked) or unreachable ends by itself at its next page, when it finds the job
   * paused or cancelled.
   */
  async discard(job: QueuedJob, runSeq: number): Promise<void> {
    try {
      await withTimeout(this.queueOf(job).remove(jobIds.importRun(job.id, runSeq)));
    } catch {
      // See above: the run notices the new status on its own.
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await Promise.all(
      Object.values(this.queues).map((queue) => queue.close().catch(() => undefined)),
    );
  }

  private queueOf(job: QueuedJob): Queue<ImportJobData> {
    return this.queues[queueForJobType(job.type) as RunQueueName];
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
