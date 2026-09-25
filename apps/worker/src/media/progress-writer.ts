import type { DownloadStore, TryProgress, TryRef } from './download-store.js';

/**
 * Writes a try's progress at most once per interval (the latest value wins), in order. A write
 * that finds the row taken away (paused, cancelled, switched off) calls `onLost`, which stops
 * the try.
 */
export class ProgressWriter {
  private lastWrite = 0;
  private latest: TryProgress | null = null;
  private chain: Promise<void> = Promise.resolve();

  constructor(
    private readonly store: DownloadStore,
    private readonly task: TryRef,
    private readonly intervalMs: number,
    private readonly onLost: () => void,
  ) {}

  report(progress: TryProgress): void {
    this.latest = progress;
    const now = Date.now();
    if (now - this.lastWrite < this.intervalMs) {
      return;
    }
    this.lastWrite = now;
    this.enqueue();
  }

  /** Writes at once, e.g. when the try moves to its next stage. */
  async moveTo(progress: TryProgress): Promise<void> {
    this.latest = progress;
    this.lastWrite = Date.now();
    this.enqueue();
    await this.chain;
  }

  /** Resolves once every pending write is done. */
  flush(): Promise<void> {
    return this.chain;
  }

  private enqueue(): void {
    this.chain = this.chain.then(async () => {
      const latest = this.latest;
      if (!latest) {
        return;
      }
      try {
        if (!(await this.store.progress(this.task, latest))) {
          this.onLost();
        }
      } catch {
        // A missed progress write changes nothing: the next one (or the result) follows.
      }
    });
  }
}
