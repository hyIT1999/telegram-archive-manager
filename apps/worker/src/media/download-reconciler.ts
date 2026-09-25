import { readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { InjectQueue } from '@nestjs/bullmq';
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { DownloadStatus, type MediaDownloadJobData, QUEUES, jobIds } from '@tam/shared';
import type { Queue } from 'bullmq';
import { errorMessage } from '../common/error-message.js';
import { DownloadStore } from './download-store.js';
import { MEDIA_SETTINGS, type MediaSettings } from './media-settings.js';
import { StorageTargets } from './storage-targets.js';

export interface DownloadReconcileReport {
  /** ACTIVE tries whose queue job was gone, put back in line (they resume from their part). */
  requeued: number;
  /** Tries BullMQ failed on, recorded as failed tries (the last one makes the file FAILED). */
  failed: number;
  /** Partial files nobody needs any more, deleted. */
  removedParts: number;
}

const PART_FILE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.part$/i;

/** Partial files of media in these states are never resumed. */
const FINISHED = new Set<string>([
  DownloadStatus.DOWNLOADED,
  DownloadStatus.SKIPPED,
  DownloadStatus.CANCELLED,
]);

/**
 * PostgreSQL is the source of truth; the queue only carries tries. At startup and every minute
 * this puts back in line ACTIVE downloads whose queue job vanished (Redis lost it, or the worker
 * died between claiming and queueing), records tries BullMQ failed on, and deletes partial files
 * nobody will resume.
 */
@Injectable()
export class DownloadReconciler implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(DownloadReconciler.name);
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<unknown> | undefined;

  constructor(
    private readonly store: DownloadStore,
    private readonly targets: StorageTargets,
    @InjectQueue(QUEUES.mediaDownload) private readonly queue: Queue<MediaDownloadJobData>,
    @Inject(MEDIA_SETTINGS) private readonly settings: MediaSettings,
  ) {}

  onApplicationBootstrap(): void {
    this.tick();
    this.timer = setInterval(() => this.tick(), this.settings.reconcileIntervalMs);
    this.timer.unref();
  }

  async onModuleDestroy(): Promise<void> {
    clearInterval(this.timer);
    await this.idle();
  }

  /** Resolves when no reconciliation is running (shutdown, tests). */
  async idle(): Promise<void> {
    await this.running;
  }

  async reconcile(): Promise<DownloadReconcileReport> {
    const report: DownloadReconcileReport = { requeued: 0, failed: 0, removedParts: 0 };
    const quiet = await this.store.quietTries(new Date(Date.now() - this.settings.lostAfterMs));
    for (const job of quiet) {
      const queued = await this.queue.getJob(jobIds.mediaDownload(job.id, job.runSeq));
      if (!queued) {
        const result = await this.store.release(job, {
          error: 'The download was interrupted; it goes on where it stopped',
          retryAt: new Date(),
          countsAsTry: false,
        });
        if (result !== 'stale') {
          report.requeued += 1;
        }
      } else if (await queued.isFailed()) {
        const result = await this.store.release(job, {
          error: queued.failedReason || 'The download failed',
          retryAt: new Date(Date.now() + this.settings.retryBaseMs),
          countsAsTry: true,
        });
        if (result === 'failed') {
          report.failed += 1;
        } else if (result === 'waiting') {
          report.requeued += 1;
        }
      }
    }
    report.removedParts = await this.removeUnneededParts();
    if (report.requeued > 0 || report.failed > 0 || report.removedParts > 0) {
      this.logger.log(
        `Downloads reconciled: ${report.requeued} put back in line, ${report.failed} failed, ` +
          `${report.removedParts} partial file(s) removed`,
      );
    }
    return report;
  }

  private async removeUnneededParts(): Promise<number> {
    let removed = 0;
    for (const dir of await this.targets.stagingDirs()) {
      let names: string[];
      try {
        names = (await readdir(dir)).filter((name) => PART_FILE.test(name));
      } catch {
        continue; // Not created yet, or not reachable right now.
      }
      if (names.length === 0) {
        continue;
      }
      const statuses = await this.store.mediaStatuses(
        names.map((name) => name.slice(0, -'.part'.length)),
      );
      for (const name of names) {
        const status = statuses.get(name.slice(0, -'.part'.length));
        const file = path.join(dir, name);
        if (
          status === undefined ||
          FINISHED.has(status) ||
          (await this.isAbandoned(file, status))
        ) {
          try {
            await rm(file, { force: true });
            removed += 1;
          } catch (error) {
            this.logger.warn(`Could not remove ${file}: ${errorMessage(error)}`);
          }
        }
      }
    }
    return removed;
  }

  /** A partial file nobody touched for a long time, of a file not being downloaded right now. */
  private async isAbandoned(file: string, status: DownloadStatus): Promise<boolean> {
    if (status === DownloadStatus.DOWNLOADING) {
      return false;
    }
    try {
      return Date.now() - (await stat(file)).mtimeMs > this.settings.partRetentionMs;
    } catch {
      return false;
    }
  }

  private tick(): void {
    if (this.running) {
      return;
    }
    this.running = this.reconcile()
      .catch((error: unknown) =>
        this.logger.warn(`Reconciling downloads failed: ${errorMessage(error)}`),
      )
      .finally(() => {
        this.running = undefined;
      });
  }
}
