import { type Job, WaitingError } from 'bullmq';

/** Reason the ShutdownCoordinator passes to Worker#cancelAllJobs() when the process stops. */
export const SHUTDOWN_ABORT_REASON = 'shutdown';

/** True when the job's signal fired because the worker is shutting down (not a user cancel). */
export function isShutdownAbort(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true && signal.reason === SHUTDOWN_ABORT_REASON;
}

/**
 * Hands an active job back to its queue at a safe point during shutdown. The job returns to the
 * front of 'wait', and the WaitingError tells BullMQ the job neither completed nor failed, so
 * attemptsMade stays unchanged and the next worker run picks the job up again.
 *
 * Always throws: let the WaitingError propagate out of process().
 */
export async function requeueForShutdown(job: Job, token: string | undefined): Promise<never> {
  if (!token) {
    throw new Error(`Cannot requeue job ${job.id}: process() received no lock token`);
  }
  await job.moveToWait(token);
  throw new WaitingError();
}
