import { createHash } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { open } from 'node:fs/promises';
import {
  DOWNLOAD_RESUME_ALIGNMENT,
  type DownloadOptions,
  type DownloadedFile,
  MediaUnavailableError,
  decodeFileId,
} from '@tam/telegram';
import type { createFakeTelegramApi } from './telegram-fixtures.js';

type FakeApi = ReturnType<typeof createFakeTelegramApi>['api'];

/** Bytes per write of the fake download (and per progress report). */
const CHUNK = 256 * 1024;

/** A pause point: the download stops after `afterBytes` until released (or aborted). */
export interface Hold {
  /** Resolves once the download reached the pause point. */
  reached: Promise<void>;
  release(): void;
}

interface ScriptedFailure {
  error: Error;
  /** Bytes written before the failure (from the resume point); 0 fails at once. */
  afterBytes: number;
}

/** Deterministic content: the same id and size always give the same bytes. */
export function fakeContent(fileUniqueId: string, size: number): Buffer {
  const content = Buffer.alloc(size);
  let block = createHash('sha256').update(fileUniqueId).digest();
  for (let offset = 0; offset < size; offset += block.length) {
    block.copy(content, offset, 0, Math.min(block.length, size - offset));
    block = createHash('sha256').update(block).digest();
  }
  return content;
}

/**
 * Telegram files for the fake adapter, downloaded with the same contract as
 * MtcuteTelegramAdapter.downloadFile: resuming at the last whole MiB of the partial file, reporting
 * progress, stopping when the signal aborts. Failures and pause points can be scripted.
 */
export class FakeFiles {
  private readonly files = new Map<string, Buffer>();
  private readonly previews = new Map<string, Buffer | null>();
  private readonly failures = new Map<string, ScriptedFailure[]>();
  private readonly holds = new Map<
    string,
    { afterBytes: number; reached: () => void; released: Promise<void> }
  >();
  /** Every download asked for: the file and the offset it resumed at. */
  readonly downloads: { fileUniqueId: string; offset: number }[] = [];

  constructor(api: FakeApi) {
    api.downloadFile.mockImplementation((fileId, options) => this.download(fileId, options));
    api.getThumbnails.mockImplementation(
      async (_chatId, files) =>
        new Map(
          files.map((file) => [file.fileUniqueId, this.previews.get(file.fileUniqueId) ?? null]),
        ),
    );
  }

  /** A file Telegram serves; returns its bytes. */
  add(fileUniqueId: string, size: number): Buffer {
    const content = fakeContent(fileUniqueId, size);
    this.files.set(fileUniqueId, content);
    return content;
  }

  /** The file is gone from Telegram (message deleted). */
  remove(fileUniqueId: string): void {
    this.files.delete(fileUniqueId);
  }

  /** The preview Telegram has for a file (null: none). */
  preview(fileUniqueId: string, bytes: Buffer | null): void {
    this.previews.set(fileUniqueId, bytes);
  }

  /** The next download of the file fails with `error`, after writing `afterBytes`. */
  failNext(fileUniqueId: string, error: Error, afterBytes = 0): void {
    this.failures.set(fileUniqueId, [
      ...(this.failures.get(fileUniqueId) ?? []),
      { error, afterBytes },
    ]);
  }

  /** The next download of the file pauses after `afterBytes` until released. */
  hold(fileUniqueId: string, afterBytes: number): Hold {
    let reached!: () => void;
    let release!: () => void;
    const reachedPromise = new Promise<void>((resolve) => {
      reached = resolve;
    });
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.holds.set(fileUniqueId, { afterBytes, reached, released });
    return { reached: reachedPromise, release };
  }

  private async download(fileId: string, options: DownloadOptions = {}): Promise<DownloadedFile> {
    const { fileUniqueId } = decodeFileId(fileId);
    const content = this.files.get(fileUniqueId);
    if (!content) {
      throw new MediaUnavailableError('MESSAGE_DELETED');
    }
    const destPath = options.destPath;
    if (!destPath) {
      throw new Error('downloadFile needs destPath');
    }
    const failure = this.failures.get(fileUniqueId)?.shift();
    const hold = this.holds.get(fileUniqueId);
    this.holds.delete(fileUniqueId);
    const handle = await open(destPath, fsConstants.O_RDWR | fsConstants.O_CREAT);
    try {
      const { size: stored } = await handle.stat();
      let position =
        Math.floor(Math.min(options.offset ?? 0, stored) / DOWNLOAD_RESUME_ALIGNMENT) *
        DOWNLOAD_RESUME_ALIGNMENT;
      this.downloads.push({ fileUniqueId, offset: position });
      await handle.truncate(position);
      const start = position;
      if (failure && failure.afterBytes === 0) {
        throw failure.error;
      }
      while (position < content.length) {
        options.signal?.throwIfAborted();
        const end = Math.min(content.length, position + CHUNK);
        await handle.write(content, position, end - position, position);
        position = end;
        options.onProgress?.(position, content.length);
        if (failure && position - start >= failure.afterBytes) {
          throw failure.error;
        }
        if (hold && position - start >= hold.afterBytes) {
          hold.reached();
          await Promise.race([hold.released, aborted(options.signal)]);
          hold.afterBytes = Number.POSITIVE_INFINITY;
        }
        // Let other work (progress writes, aborts) run between chunks, like real network reads.
        await new Promise((resolve) => setImmediate(resolve));
      }
      return { path: destPath, size: content.length, mimeType: null, fileName: null };
    } finally {
      await handle.close();
    }
  }
}

/** Rejects when the signal aborts (never, without one). */
function aborted(signal: AbortSignal | undefined): Promise<never> {
  return new Promise((_resolve, reject) => {
    if (!signal) {
      return;
    }
    if (signal.aborted) {
      reject(signal.reason instanceof Error ? signal.reason : new Error('Aborted'));
      return;
    }
    signal.addEventListener(
      'abort',
      () => reject(signal.reason instanceof Error ? signal.reason : new Error('Aborted')),
      { once: true },
    );
  });
}
