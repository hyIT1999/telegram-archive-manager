import { type Job, WaitingError } from 'bullmq';
import { describe, expect, it, vi } from 'vitest';
import {
  isShutdownAbort,
  requeueForShutdown,
  SHUTDOWN_ABORT_REASON,
} from '../src/shutdown/shutdown-abort.js';

function abortedWith(reason: unknown): AbortSignal {
  const controller = new AbortController();
  controller.abort(reason);
  return controller.signal;
}

describe('isShutdownAbort', () => {
  it('is true only for a signal aborted because the worker shuts down', () => {
    expect(isShutdownAbort(abortedWith(SHUTDOWN_ABORT_REASON))).toBe(true);
    expect(isShutdownAbort(abortedWith('cancelled by user'))).toBe(false);
    expect(isShutdownAbort(new AbortController().signal)).toBe(false);
    expect(isShutdownAbort(undefined)).toBe(false);
  });
});

describe('requeueForShutdown', () => {
  function fakeJob() {
    const moveToWait = vi.fn<(token?: string) => Promise<number>>().mockResolvedValue(0);
    return { job: { id: 'media-1', moveToWait } as unknown as Job, moveToWait };
  }

  it('moves the job back to wait under its lock, then throws WaitingError', async () => {
    const { job, moveToWait } = fakeJob();
    await expect(requeueForShutdown(job, 'worker-token:1')).rejects.toBeInstanceOf(WaitingError);
    expect(moveToWait).toHaveBeenCalledExactlyOnceWith('worker-token:1');
  });

  it('refuses to move a job without the lock token', async () => {
    const { job, moveToWait } = fakeJob();
    await expect(requeueForShutdown(job, undefined)).rejects.toThrow(/no lock token/);
    expect(moveToWait).not.toHaveBeenCalled();
  });
});
