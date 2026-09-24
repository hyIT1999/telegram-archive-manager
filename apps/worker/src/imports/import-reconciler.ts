import { InjectQueue } from '@nestjs/bullmq';
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { PrismaService } from '@tam/database/nest';
import {
  IMPORT_RUN_JOB_NAME,
  type ImportJobData,
  JobStatus,
  QUEUES,
  importRunJobOptions,
  jobIds,
} from '@tam/shared';
import type { Queue } from 'bullmq';
import { errorMessage } from '../common/error-message.js';
import { IMPORT_SETTINGS, type ImportSettings } from './import-settings.js';
import { ImportRunner } from './import-runner.js';

export interface ReconcileReport {
  /** Unfinished jobs whose run was missing from the queue and was added again. */
  enqueued: number;
  /** Unfinished jobs whose run BullMQ had given up on, now marked FAILED. */
  failed: number;
}

/**
 * PostgreSQL is the source of truth; the queue only carries runs. At startup and every minute
 * this makes sure every PENDING or RUNNING import job has its run in the queue: the api's enqueue
 * may have failed (Redis down), Redis may have lost data, or the worker may have died between
 * BullMQ failing a run and the database recording it. Adding a run is idempotent (its id is fixed
 * by job and run number), and a run that finds its job paused or cancelled ends at once.
 */
@Injectable()
export class ImportReconciler implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(ImportReconciler.name);
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<unknown> | undefined;

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(QUEUES.telegramImport) private readonly queue: Queue<ImportJobData>,
    private readonly runner: ImportRunner,
    @Inject(IMPORT_SETTINGS) private readonly settings: ImportSettings,
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

  async reconcile(): Promise<ReconcileReport> {
    const report: ReconcileReport = { enqueued: 0, failed: 0 };
    const jobs = await this.prisma.importJob.findMany({
      where: { status: { in: [JobStatus.PENDING, JobStatus.RUNNING] } },
      select: { id: true, runSeq: true },
      orderBy: { createdAt: 'asc' },
    });
    for (const job of jobs) {
      const data: ImportJobData = { importJobId: job.id, runSeq: job.runSeq };
      const run = await this.queue.getJob(jobIds.importRun(job.id, job.runSeq));
      if (!run) {
        await this.queue.add(IMPORT_RUN_JOB_NAME, data, importRunJobOptions(job.id, job.runSeq));
        report.enqueued += 1;
      } else if (await run.isFailed()) {
        const reason = run.failedReason || 'the run failed';
        if (
          await this.runner.fail(
            data,
            `The import stopped after ${run.attemptsMade} tries: ${reason}`,
          )
        ) {
          report.failed += 1;
        }
      }
    }
    if (report.enqueued > 0 || report.failed > 0) {
      this.logger.log(
        `Import jobs reconciled: ${report.enqueued} run(s) queued again, ${report.failed} marked failed`,
      );
    }
    return report;
  }

  private tick(): void {
    if (this.running) {
      return;
    }
    this.running = this.reconcile()
      .catch((error: unknown) =>
        this.logger.warn(`Reconciling import jobs failed: ${errorMessage(error)}`),
      )
      .finally(() => {
        this.running = undefined;
      });
  }
}
