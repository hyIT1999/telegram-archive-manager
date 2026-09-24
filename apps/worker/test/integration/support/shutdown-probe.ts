import { BullModule, Processor } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import type { Job } from 'bullmq';
import {
  AbortableWorkerHost,
  isShutdownAbort,
  requeueForShutdown,
} from '../../../src/shutdown/index.js';
import { WorkerModule } from '../../../src/worker.module.js';

/** Queue used only by these tests. */
export const PROBE_QUEUE = 'shutdown-probe';

/** Upper bound for a probe job, so a missing abort fails the test instead of hanging it. */
const MAX_JOB_MS = 20_000;

/**
 * TEST-ONLY processor standing in for the long import/download processors of Phases 3–4: it
 * blocks until its AbortSignal fires, then hands the job back the way those processors will.
 */
@Processor(PROBE_QUEUE)
export class ShutdownProbeProcessor extends AbortableWorkerHost {
  private readonly firstJob = Promise.withResolvers<string | undefined>();
  /** Resolves with the id of the first job that starts. */
  readonly started = this.firstJob.promise;
  /** Ordered notes shared with the test, e.g. to check what ran before the database closed. */
  readonly timeline: string[] = [];
  abortReason: unknown;

  override async process(job: Job, token?: string, signal?: AbortSignal): Promise<void> {
    this.firstJob.resolve(job.id);
    await untilAborted(signal);
    this.abortReason = signal?.reason;
    if (isShutdownAbort(signal)) {
      try {
        await requeueForShutdown(job, token);
      } finally {
        this.timeline.push('job requeued');
      }
    }
    throw new Error(`Probe job ${job.id} was aborted for an unexpected reason`);
  }
}

function untilAborted(signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!signal) {
      reject(new Error('BullMQ passed no AbortSignal'));
      return;
    }
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(
      () => reject(new Error('The probe job was never aborted')),
      MAX_JOB_MS,
    );
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

/** The production WorkerModule plus the probe queue and its processor. */
@Module({
  imports: [WorkerModule, BullModule.registerQueue({ name: PROBE_QUEUE })],
  providers: [ShutdownProbeProcessor],
})
export class ShutdownProbeModule {}
