import { WorkerHost } from '@nestjs/bullmq';
import type { Job, Worker } from 'bullmq';

/**
 * Base class for processors of long jobs (history imports, media downloads) that must stop
 * cleanly when the worker shuts down.
 *
 * BullMQ creates a job's AbortSignal only for processor functions that declare three parameters
 * (`Worker#processorAcceptsSignal = processor.length >= 3`), and @nestjs/bullmq hands BullMQ the
 * bound `process` method, which keeps its length. So subclasses declare
 * `process(job, token, signal)`, which the constructor checks. They must also stay
 * singleton-scoped: @nestjs/bullmq wraps request-scoped processors in a variadic function, and
 * those never receive a signal.
 *
 * On shutdown the ShutdownCoordinator aborts every active job with SHUTDOWN_ABORT_REASON. The
 * processor passes the signal to long operations and hands the job back at a safe point:
 *
 * ```ts
 * override async process(job: Job<MediaDownloadJobData>, token?: string, signal?: AbortSignal) {
 *   try {
 *     return await this.downloader.download(job.data.mediaId, { signal });
 *   } catch (error) {
 *     if (isShutdownAbort(signal)) await requeueForShutdown(job, token);
 *     throw error;
 *   }
 * }
 * ```
 */
export abstract class AbortableWorkerHost<
  TWorker extends Worker = Worker,
> extends WorkerHost<TWorker> {
  constructor() {
    super();
    if (this.process.length < 3) {
      throw new Error(
        `${new.target.name}.process() must declare (job, token, signal): ` +
          'BullMQ only passes an AbortSignal to processors with three parameters.',
      );
    }
  }

  abstract override process(job: Job, token?: string, signal?: AbortSignal): Promise<unknown>;
}
