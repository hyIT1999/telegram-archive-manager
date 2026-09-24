import type { Job } from 'bullmq';
import { describe, expect, it } from 'vitest';
import { AbortableWorkerHost } from '../src/shutdown/abortable-worker-host.js';

class SignalAwareProcessor extends AbortableWorkerHost {
  override process(_job: Job, _token?: string, _signal?: AbortSignal): Promise<void> {
    return Promise.resolve();
  }
}

class SignalBlindProcessor extends AbortableWorkerHost {
  // Type-checks (fewer parameters are allowed) but BullMQ would never pass it a signal.
  override process(_job: Job): Promise<void> {
    return Promise.resolve();
  }
}

describe('AbortableWorkerHost', () => {
  it('accepts a processor that declares (job, token, signal)', () => {
    expect(() => new SignalAwareProcessor()).not.toThrow();
  });

  it('rejects a processor that BullMQ would not give an AbortSignal', () => {
    expect(() => new SignalBlindProcessor()).toThrow(
      /^SignalBlindProcessor\.process\(\) must declare \(job, token, signal\)/,
    );
  });
});
