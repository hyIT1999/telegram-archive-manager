import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, rm, stat, statfs } from 'node:fs/promises';
import path from 'node:path';
import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  DownloadJobStatus,
  DownloadSkipReason,
  DownloadStage,
  type MediaDownloadJobData,
  TelegramErrorCode,
} from '@tam/shared';
import {
  StorageIntegrityError,
  StorageNotFoundError,
  StorageUnavailableError,
  UnsafeKeyError,
  assertSafeKey,
  buildMediaPath,
  classifyStorageFailure,
  extensionFor,
} from '@tam/storage';
import {
  AuthRequiredError,
  ChatProtectedError,
  ChatUnavailableError,
  FloodWaitError,
  LoginStepError,
  MediaUnavailableError,
  TelegramTimeoutError,
} from '@tam/telegram';
import { errorMessage } from '../common/error-message.js';
import { TelegramAuthService } from '../telegram/telegram-auth.service.js';
import { TelegramCooldown } from '../telegram/telegram-cooldown.js';
import {
  TELEGRAM_API_PROVIDER,
  type TelegramApiProvider,
  TelegramUnavailableError,
} from '../telegram/telegram.tokens.js';
import { type DownloadTask, DownloadStore } from './download-store.js';
import { MEDIA_SETTINGS, type MediaSettings } from './media-settings.js';
import { ProgressWriter } from './progress-writer.js';
import { SpaceGuard, type SpaceNeed, type SpaceShortage, isShortage } from './space-guard.js';
import { LocationError, type StorageTarget, StorageTargets } from './storage-targets.js';

/** How one try ended. */
export type DownloadOutcome =
  /** The file is stored. */
  | 'completed'
  /** Back in line without using a try: Telegram, space or a person must come first. */
  | 'waiting'
  /** Failed; tried again later. */
  | 'retry'
  /** Failed for good (FAILED). */
  | 'failed'
  /** Not downloaded: deleted on Telegram, or content protection. */
  | 'skipped'
  /** Paused, cancelled or switched off meanwhile. */
  | 'interrupted'
  /** An outdated try (a newer one owns the row). */
  | 'stale';

const MINUTE = 60_000;
/** A full location is looked at again after this long. */
const FULL_PAUSE_MS = 10 * MINUTE;
/** A location that needs a person (reconnect, permissions, server setup) is tried again after this long. */
const ATTENTION_PAUSE_MS = 30 * MINUTE;
/** Drive rate limits in a row wait 15 min, 1 h, 3 h, then 6 h (its daily upload cap resets within a day). */
const RATE_LIMIT_PAUSES_MS = [15 * MINUTE, 60 * MINUTE, 180 * MINUTE, 360 * MINUTE];
/** A second copy of a file being downloaded waits for it, then copies it. */
const TWIN_WAIT_MS = 30_000;
/** Files asked for in a chat the account can no longer read are tried again after this long. */
const CHAT_UNAVAILABLE_RETRY_MS = 60 * MINUTE;

const PROTECTED_MESSAGE =
  'Content protection was turned on for this chat, so its files are not downloaded.';
const NO_LOCATION_MESSAGE =
  'No storage location: choose one for this channel, or make one the default (Settings → Storage locations).';
const RATE_LIMITED_MESSAGE =
  'Google Drive is limiting uploads (it may be its 750 GB-a-day upload cap); downloads to it continue later.';

interface StoredCopy {
  checksum: string;
  size: number;
}

function later(milliseconds: number): Date {
  return new Date(Date.now() + milliseconds);
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) {
    return `${(bytes / 1024 ** 3).toFixed(1)} GiB`;
  }
  return bytes >= 1024 ** 2
    ? `${Math.round(bytes / 1024 ** 2)} MiB`
    : `${Math.round(bytes / 1024)} KiB`;
}

async function fileSize(file: string): Promise<number> {
  try {
    return (await stat(file)).size;
  } catch {
    return 0;
  }
}

async function freeBytesOf(folder: string): Promise<number> {
  const info = await statfs(folder);
  return info.bavail * info.bsize;
}

async function removePart(partPath: string | null): Promise<void> {
  if (partPath) {
    await rm(partPath, { force: true }).catch(() => undefined);
  }
}

export async function sha256File(file: string, signal?: AbortSignal): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file, signal ? { signal } : {})) {
    hash.update(chunk as Buffer);
  }
  return hash.digest('hex');
}

/** "…/42 - lesson.mp4" → "…/42 - lesson-AbC123.mp4": a second file of one message gets its own name. */
export function withSuffix(key: string, fileUniqueId: string): string {
  const suffix = fileUniqueId.replace(/[^\w-]/g, '').slice(-6) || 'copy';
  const slash = key.lastIndexOf('/');
  const name = key.slice(slash + 1);
  const dot = name.lastIndexOf('.');
  const renamed =
    dot > 0 ? `${name.slice(0, dot)}-${suffix}${name.slice(dot)}` : `${name}-${suffix}`;
  return assertSafeKey(`${key.slice(0, slash + 1)}${renamed}`);
}

/**
 * Downloads one media file into its channel's storage location, resuming a partial file:
 *
 * 1. the file goes to `<staging>/<media id>.part` (for a folder on this server: a hidden folder
 *    on the same disk, so storing it is a rename);
 * 2. its size is checked and its SHA-256 computed;
 * 3. the driver stores it under the readable path of paths.ts, and the row becomes COMPLETED.
 *
 * A file already stored by an earlier try (crash before the database noticed) or with the same
 * Telegram file elsewhere in the location is reused. Waiting for Telegram, for space or for a
 * person never uses up a try; other failures are retried with growing delays.
 */
@Injectable()
export class MediaDownloader {
  private readonly logger = new Logger(MediaDownloader.name);
  /** Telegram files (file_unique_id) being fetched right now. */
  private readonly fetching = new Set<string>();
  /** Paths being written right now, per location. */
  private readonly writing = new Set<string>();
  /** Drive rate limits in a row, per location. */
  private readonly rateLimits = new Map<string, number>();

  constructor(
    private readonly store: DownloadStore,
    private readonly targets: StorageTargets,
    private readonly space: SpaceGuard,
    private readonly cooldown: TelegramCooldown,
    private readonly auth: TelegramAuthService,
    @Inject(TELEGRAM_API_PROVIDER) private readonly telegram: TelegramApiProvider,
    @Inject(MEDIA_SETTINGS) private readonly settings: MediaSettings,
  ) {}

  /** Throws only when the worker shuts down (the processor hands the job back) or on database errors. */
  async run(data: MediaDownloadJobData, signal?: AbortSignal): Promise<DownloadOutcome> {
    const task = await this.store.load({ id: data.downloadJobId, runSeq: data.runSeq });
    if (!task) {
      return 'stale';
    }
    if (task.channel.isProtected) {
      await this.store.skip(task, DownloadSkipReason.PROTECTED, PROTECTED_MESSAGE);
      return 'skipped';
    }
    if (this.fetching.has(task.media.telegramFileUniqueId)) {
      return this.wait(
        task,
        'Waiting for the same file, downloaded for another message right now',
        TWIN_WAIT_MS,
      );
    }
    if (!(await this.store.begin(task, DownloadStage.FETCHING))) {
      return 'stale';
    }
    // Losing the row (paused, cancelled, switched off) stops the try like a shutdown does, but the
    // job is not handed back to the queue.
    const ownership = new AbortController();
    const stop = signal ? AbortSignal.any([signal, ownership.signal]) : ownership.signal;
    let target: StorageTarget | null = null;
    let partPath: string | null = null;
    let slot: string | null = null;
    this.fetching.add(task.media.telegramFileUniqueId);
    try {
      target = await this.targets.resolve(task.channel);
      if (!target) {
        return await this.wait(task, NO_LOCATION_MESSAGE, FULL_PAUSE_MS);
      }
      const key = await this.claimKey(task, target);
      slot = `${target.location.id}:${key}`;
      partPath = path.join(target.stagingDir, `${task.media.id}.part`);
      const copy =
        (await this.copyTwin(task, target, key)) ??
        (await this.alreadyStored(task, target, key, partPath));
      if (copy) {
        await removePart(partPath);
        return await this.finish(task, target, key, copy);
      }
      return await this.transfer(task, target, key, partPath, stop, ownership);
    } catch (error) {
      if (signal?.aborted) {
        throw error;
      }
      if (ownership.signal.aborted) {
        return await this.afterLosingRow(task, partPath);
      }
      return await this.handleFailure(task, error, target, partPath);
    } finally {
      this.fetching.delete(task.media.telegramFileUniqueId);
      if (slot) {
        this.writing.delete(slot);
      }
    }
  }

  /** The readable path, unless another file of the location uses it (then with a suffix). */
  private async claimKey(task: DownloadTask, target: StorageTarget): Promise<string> {
    const base = buildMediaPath({
      channelFolder: target.folder,
      postedAt: task.message.telegramDate,
      telegramMessageId: task.message.telegramMessageId,
      fileName: task.media.filename,
      extension: extensionFor(task.media.mimeType, task.media.type),
    });
    for (const key of [base, withSuffix(base, task.media.telegramFileUniqueId)]) {
      const slot = `${target.location.id}:${key}`;
      if (
        !this.writing.has(slot) &&
        !(await this.store.keyTaken(target.location.id, key, task.media.id))
      ) {
        this.writing.add(slot);
        return key;
      }
    }
    throw new UnsafeKeyError(base);
  }

  /** The same Telegram file is already stored in this location (sent twice): copy it. */
  private async copyTwin(
    task: DownloadTask,
    target: StorageTarget,
    key: string,
  ): Promise<StoredCopy | null> {
    const twin = await this.store.storedTwin(
      { ...task, fileUniqueId: task.media.telegramFileUniqueId },
      target.location.id,
    );
    if (!twin?.storageKey || !twin.checksum) {
      return null;
    }
    try {
      await target.driver.duplicate(twin.storageKey, key);
    } catch (error) {
      if (error instanceof StorageNotFoundError) {
        return null; // The copy went missing: download instead.
      }
      throw error;
    }
    const size =
      twin.size === null ? ((await target.driver.stat(key))?.size ?? 0) : Number(twin.size);
    return { checksum: twin.checksum, size };
  }

  /** An earlier try stored the file but stopped before the database noticed. */
  private async alreadyStored(
    task: DownloadTask,
    target: StorageTarget,
    key: string,
    partPath: string,
  ): Promise<StoredCopy | null> {
    const size = task.media.size === null ? null : Number(task.media.size);
    if (size === null) {
      return null;
    }
    const existing = await target.driver.stat(key);
    if (!existing || existing.size !== size) {
      return null;
    }
    if (existing.sha256) {
      return { checksum: existing.sha256.toLowerCase(), size };
    }
    const local = target.driver.localPath(key);
    if (local) {
      return { checksum: await sha256File(local), size };
    }
    return (await fileSize(partPath)) === size
      ? { checksum: await sha256File(partPath), size }
      : null;
  }

  private async transfer(
    task: DownloadTask,
    target: StorageTarget,
    key: string,
    partPath: string,
    stop: AbortSignal,
    ownership: AbortController,
  ): Promise<DownloadOutcome> {
    const { media } = task;
    await mkdir(target.stagingDir, { recursive: true });
    const partBytes = await fileSize(partPath);
    const total = media.size === null ? null : Number(media.size);
    const reservation = this.space.reserve(await this.spaceNeeds(target, total, partBytes));
    if (isShortage(reservation)) {
      return this.waitForSpace(task, target, reservation);
    }
    const progress = new ProgressWriter(this.store, task, this.settings.progressIntervalMs, () =>
      ownership.abort(new Error('The download was paused, cancelled or switched off')),
    );
    try {
      const started = Date.now();
      const file = await this.telegram.api.downloadFile(media.telegramFileId, {
        destPath: partPath,
        offset: partBytes,
        signal: stop,
        stallTimeoutMs: this.settings.stallTimeoutMs,
        onProgress: (bytes, size) =>
          progress.report({ bytes, total: size ?? total, stage: DownloadStage.FETCHING }),
      });
      if (total !== null && file.size !== total) {
        await removePart(partPath);
        throw new StorageIntegrityError(`Telegram sent ${file.size} bytes instead of ${total}`);
      }
      await progress.moveTo({ bytes: 0, total: file.size, stage: DownloadStage.VERIFYING });
      stop.throwIfAborted();
      const checksum = await sha256File(partPath, stop);
      await progress.moveTo({ bytes: 0, total: file.size, stage: DownloadStage.STORING });
      stop.throwIfAborted();
      const stored = await target.driver.putFile(key, partPath, {
        contentType: media.mimeType ?? file.mimeType ?? 'application/octet-stream',
        sha256: checksum,
        signal: stop,
        onProgress: (bytes) =>
          progress.report({ bytes, total: file.size, stage: DownloadStage.STORING }),
      });
      await progress.flush();
      await removePart(partPath);
      const seconds = Math.max(1, (Date.now() - started) / 1000);
      this.logger.log(
        `Stored ${key} (${formatBytes(stored.size)}, ${formatBytes((file.size - partBytes) / seconds)}/s from Telegram` +
          `${partBytes > 0 ? `, resumed at ${formatBytes(partBytes)}` : ''})`,
      );
      return await this.finish(task, target, key, { checksum, size: stored.size });
    } finally {
      await progress.flush();
      reservation.release();
    }
  }

  private async finish(
    task: DownloadTask,
    target: StorageTarget,
    key: string,
    stored: StoredCopy,
  ): Promise<DownloadOutcome> {
    this.rateLimits.delete(target.location.id);
    const done = await this.store.complete(task, {
      locationId: target.location.id,
      key,
      checksum: stored.checksum,
      size: stored.size,
    });
    if (done) {
      return 'completed';
    }
    // Cancelled while the file was being stored: it must not stay behind.
    if ((await this.store.statusOf(task.id)) === DownloadJobStatus.CANCELLED) {
      await target.driver.delete(key).catch(() => undefined);
    }
    return 'interrupted';
  }

  private async spaceNeeds(
    target: StorageTarget,
    total: number | null,
    partBytes: number,
  ): Promise<SpaceNeed[]> {
    const remaining = Math.max(0, (total ?? 0) - partBytes);
    const locationSpace = await target.driver.space();
    const location: SpaceNeed = {
      key: `location:${target.location.id}`,
      freeBytes: locationSpace.freeBytes,
      bytes: remaining,
      keepFree: this.settings.minFreeBytes,
    };
    if (target.location.kind === 'LOCAL') {
      return [location];
    }
    // Google Drive: the file first waits in the staging folder on this server.
    return [
      {
        key: `dir:${target.stagingDir}`,
        freeBytes: await freeBytesOf(target.stagingDir),
        bytes: remaining,
        keepFree: this.settings.minFreeBytes,
      },
      { ...location, bytes: total ?? 0, keepFree: 0 },
    ];
  }

  private async waitForSpace(
    task: DownloadTask,
    target: StorageTarget,
    shortage: SpaceShortage,
  ): Promise<DownloadOutcome> {
    const where = shortage.need.key.startsWith('dir:')
      ? `the staging folder ${target.stagingDir}`
      : `"${target.location.name}"`;
    const kept =
      shortage.need.keepFree > 0
        ? ` while keeping ${formatBytes(shortage.need.keepFree)} free`
        : '';
    const message =
      `Not enough free space in ${where}: the next file needs ${formatBytes(shortage.need.bytes)}, ` +
      `${formatBytes(shortage.available)} is available${kept}. Downloads to it continue once there is room.`;
    await this.store.pauseLocation(target.location.id, later(FULL_PAUSE_MS), message);
    return this.wait(task, message, FULL_PAUSE_MS);
  }

  private async afterLosingRow(
    task: DownloadTask,
    partPath: string | null,
  ): Promise<DownloadOutcome> {
    if ((await this.store.statusOf(task.id)) === DownloadJobStatus.CANCELLED) {
      await removePart(partPath);
    }
    return 'interrupted';
  }

  private async handleFailure(
    task: DownloadTask,
    error: unknown,
    target: StorageTarget | null,
    partPath: string | null,
  ): Promise<DownloadOutcome> {
    if (error instanceof FloodWaitError) {
      this.cooldown.note(error.seconds);
      return this.wait(task, `Telegram asked to wait ${error.seconds} s`, error.seconds * 1000);
    }
    if (error instanceof TelegramTimeoutError && this.cooldown.remainingMs() > 0) {
      return this.wait(task, 'Telegram asked this account to wait', this.cooldown.remainingMs());
    }
    if (
      error instanceof TelegramUnavailableError ||
      (error instanceof LoginStepError && error.code === TelegramErrorCode.TELEGRAM_NOT_READY)
    ) {
      return this.wait(
        task,
        'Waiting for the worker to connect to Telegram',
        this.settings.unavailableRetryMs,
      );
    }
    if (error instanceof AuthRequiredError) {
      await this.auth.markSessionRevoked();
      return this.wait(
        task,
        'Waiting for Telegram: log in again under Settings → Telegram',
        this.settings.unavailableRetryMs,
      );
    }
    if (error instanceof MediaUnavailableError) {
      await removePart(partPath);
      await this.store.skip(task, DownloadSkipReason.NOT_AVAILABLE, error.message);
      return 'skipped';
    }
    if (error instanceof ChatProtectedError) {
      await removePart(partPath);
      await this.store.protectChannel(task.channel.id, PROTECTED_MESSAGE);
      return 'skipped';
    }
    if (error instanceof ChatUnavailableError) {
      await this.store.stopChannel(task.channel.id, error.message);
      return this.wait(task, error.message, CHAT_UNAVAILABLE_RETRY_MS);
    }
    if (error instanceof UnsafeKeyError) {
      await this.store.fail(task, error.message);
      return 'failed';
    }

    const location = error instanceof LocationError ? error.location : (target?.location ?? null);
    const cause = error instanceof LocationError ? error.cause : error;
    if (location) {
      const kind =
        cause instanceof StorageUnavailableError
          ? 'needs-attention'
          : classifyStorageFailure(cause);
      if (kind !== 'transient' || error instanceof LocationError) {
        const pauseMs =
          kind === 'out-of-space'
            ? FULL_PAUSE_MS
            : kind === 'rate-limited'
              ? this.nextRateLimitPause(location.id)
              : ATTENTION_PAUSE_MS;
        const message = kind === 'rate-limited' ? RATE_LIMITED_MESSAGE : errorMessage(cause);
        await this.store.pauseLocation(location.id, later(pauseMs), message);
        return this.wait(task, message, pauseMs);
      }
    }

    if (error instanceof StorageIntegrityError) {
      await removePart(partPath);
    }
    const message = errorMessage(error);
    const delay = Math.min(
      this.settings.retryMaxMs,
      this.settings.retryBaseMs * 2 ** task.attempts,
    );
    const result = await this.store.release(task, {
      error: message,
      retryAt: later(delay * (0.9 + Math.random() * 0.2)),
      countsAsTry: true,
    });
    this.logger.warn(
      `Download of media ${task.media.id} failed (try ${task.attempts + 1} of ${this.settings.maxAttempts}): ${message}`,
    );
    return result === 'failed' ? 'failed' : result === 'stale' ? 'stale' : 'retry';
  }

  /** Back in line without using a try. */
  private async wait(
    task: DownloadTask,
    reason: string,
    delayMs: number,
  ): Promise<DownloadOutcome> {
    const result = await this.store.release(task, {
      error: reason,
      retryAt: later(delayMs),
      countsAsTry: false,
    });
    return result === 'stale' ? 'stale' : 'waiting';
  }

  private nextRateLimitPause(locationId: string): number {
    const count = this.rateLimits.get(locationId) ?? 0;
    this.rateLimits.set(locationId, count + 1);
    return RATE_LIMIT_PAUSES_MS[Math.min(count, RATE_LIMIT_PAUSES_MS.length - 1)] as number;
  }
}
