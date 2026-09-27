import { Inject, Injectable } from '@nestjs/common';
import {
  type Channel,
  countFinishedFile,
  type FinishedDownloadStatus,
  type Media,
  type Prisma,
  refreshMediaCounters,
} from '@tam/database';
import { PrismaService } from '@tam/database/nest';
import {
  DownloadJobStatus,
  type DownloadSkipReason,
  type DownloadStage,
  DownloadStatus,
} from '@tam/shared';
import { SYNC_NOTES } from '../common/sync-notes.js';
import { MEDIA_SETTINGS, type MediaSettings } from './media-settings.js';

/** One try of a download: the download_jobs row and the run number the scheduler gave it. */
export interface ClaimedTry {
  id: string;
  runSeq: number;
}

/** What state changes of a try need to know about it. */
export interface TryRef extends ClaimedTry {
  mediaId: string;
  importJobId: string | null;
  /** Failed tries before this one. */
  attempts: number;
}

/** A try with everything the downloader works with. */
export interface DownloadTask extends TryRef {
  /** Someone asked for this file (it ignores the channel's switch and the automatic settings). */
  requested: boolean;
  media: Media;
  message: { telegramMessageId: number; telegramDate: Date };
  channel: Channel;
}

export interface StoredFile {
  locationId: string;
  key: string;
  checksum: string;
  size: number;
}

/** How a try that ended without the file left it. */
export type ReleaseResult = 'waiting' | 'failed' | 'stale';

export interface TryProgress {
  bytes: number;
  total: number | null;
  stage: DownloadStage;
}

/** The try still owns its row: ACTIVE with its run number. */
function owned(job: ClaimedTry) {
  return { id: job.id, runSeq: job.runSeq, status: DownloadJobStatus.ACTIVE };
}

/**
 * download_jobs and the download status of media, changed together and only by compare-and-set:
 * a try writes while its row is ACTIVE with its run number, so pausing, cancelling or a newer
 * try (after a crash) makes an older one stop at its next write. A try that ends adds its file to
 * the import job's counters in the same transaction; changes of many files recount them.
 */
@Injectable()
export class DownloadStore {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(MEDIA_SETTINGS) private readonly settings: MediaSettings,
  ) {}

  /**
   * Makes up to `concurrency` downloads ACTIVE (minus those already ACTIVE): files someone asked
   * for first, then the smallest. Only files of channels with automatic downloads on (or asked
   * for), whose next try is due, and whose storage location is not waiting; nothing while
   * downloads are paused.
   */
  async claim(concurrency: number): Promise<ClaimedTry[]> {
    // One worker claims at a time, so counting first is safe; a known, small LIMIT lets
    // PostgreSQL walk download_jobs_queue_idx in queue order and stop at the first free slots.
    const [{ active } = { active: 0 }] = await this.prisma.$queryRaw<{ active: number }[]>`
      SELECT count(*)::int AS active FROM download_jobs WHERE status = 'ACTIVE'`;
    const slots = concurrency - active;
    if (slots <= 0) {
      return [];
    }
    const rows = await this.prisma.$queryRaw<{ id: string; run_seq: number }[]>`
      WITH picked AS (
        SELECT d.id
        FROM download_jobs d
        JOIN channels c ON c.id = d.channel_id
        LEFT JOIN storage_locations l ON l.id = coalesce(
          c.storage_location_id,
          (SELECT s.id FROM storage_locations s WHERE s.is_default)
        )
        WHERE d.status = 'PENDING'
          AND (d.not_before IS NULL OR d.not_before <= now())
          AND (d.requested_at IS NOT NULL OR c.download_media)
          AND (l.unavailable_until IS NULL OR l.unavailable_until <= now())
          -- Paused in Settings: read here, not from a cached copy, so a try stopped by the pause
          -- is never picked up again in the moment after it.
          AND NOT EXISTS (
            SELECT 1 FROM app_settings s WHERE s.key = 'downloads' AND s.value -> 'paused' = 'true'::jsonb
          )
        ORDER BY d.requested_at ASC NULLS LAST, d.size ASC NULLS LAST, d.id
        LIMIT ${slots}::int
        FOR UPDATE OF d SKIP LOCKED
      )
      UPDATE download_jobs d
      SET status = 'ACTIVE', run_seq = d.run_seq + 1, stage = NULL, updated_at = now()
      FROM picked
      WHERE d.id = picked.id
      RETURNING d.id, d.run_seq`;
    return rows.map((row) => ({ id: row.id, runSeq: row.run_seq }));
  }

  /** The queue did not take a claimed try: back in line, as if nothing happened. */
  async unclaim(job: ClaimedTry): Promise<void> {
    await this.prisma.downloadJob.updateMany({
      where: owned(job),
      data: { status: DownloadJobStatus.PENDING },
    });
  }

  /** The try, if it still owns its row. */
  async load(job: ClaimedTry): Promise<DownloadTask | null> {
    const row = await this.prisma.downloadJob.findUnique({
      where: { id: job.id },
      include: { media: { include: { message: { include: { channel: true } } } } },
    });
    if (!row || row.runSeq !== job.runSeq || row.status !== DownloadJobStatus.ACTIVE) {
      return null;
    }
    const { message, ...media } = row.media;
    return {
      id: row.id,
      runSeq: row.runSeq,
      mediaId: media.id,
      importJobId: row.importJobId,
      attempts: row.attempts,
      requested: row.requestedAt !== null,
      media,
      message: { telegramMessageId: message.telegramMessageId, telegramDate: message.telegramDate },
      channel: message.channel,
    };
  }

  /** The file shows as downloading; false when the try is stale. */
  begin(task: TryRef, stage: DownloadStage): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.downloadJob.updateMany({
        where: owned(task),
        data: { stage, error: null },
      });
      if (count === 0) {
        return false;
      }
      await tx.media.updateMany({
        where: { id: task.mediaId },
        data: { downloadStatus: DownloadStatus.DOWNLOADING, error: null },
      });
      return true;
    });
  }

  /** Progress of the current stage; false when the try lost its row meanwhile (it should stop). */
  progress(task: TryRef, progress: TryProgress): Promise<boolean> {
    const percent =
      progress.total !== null && progress.total > 0
        ? Math.min(99, Math.floor((progress.bytes * 100) / progress.total))
        : 0;
    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.downloadJob.updateMany({
        where: owned(task),
        data: { progress: percent, stage: progress.stage },
      });
      if (count === 0) {
        return false;
      }
      await tx.media.updateMany({
        where: { id: task.mediaId },
        data: {
          downloadedBytes: BigInt(Math.max(0, Math.trunc(progress.bytes))),
          downloadProgress: percent,
        },
      });
      return true;
    });
  }

  /** The file is stored; false when the try lost its row just before (e.g. cancelled). */
  complete(task: TryRef, file: StoredFile): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.downloadJob.updateMany({
        where: owned(task),
        data: {
          status: DownloadJobStatus.COMPLETED,
          progress: 100,
          stage: null,
          reason: null,
          error: null,
          notBefore: null,
        },
      });
      if (count === 0) {
        return false;
      }
      await tx.media.updateMany({
        where: { id: task.mediaId },
        data: {
          downloadStatus: DownloadStatus.DOWNLOADED,
          downloadProgress: 100,
          downloadedBytes: BigInt(file.size),
          storageLocationId: file.locationId,
          storageKey: file.key,
          checksum: file.checksum,
          error: null,
        },
      });
      await this.countFinished(tx, task, DownloadJobStatus.COMPLETED);
      return true;
    });
  }

  /**
   * The try ends without the file and the next one waits until `retryAt`. A failed try
   * (`countsAsTry`) counts toward maxAttempts and the last one makes the file FAILED; waiting for
   * Telegram, for space or for a person never counts.
   */
  release(
    task: TryRef,
    outcome: { error: string; retryAt: Date; countsAsTry: boolean },
  ): Promise<ReleaseResult> {
    const attempts = task.attempts + (outcome.countsAsTry ? 1 : 0);
    const failed = outcome.countsAsTry && attempts >= this.settings.maxAttempts;
    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.downloadJob.updateMany({
        where: owned(task),
        data: {
          status: failed ? DownloadJobStatus.FAILED : DownloadJobStatus.PENDING,
          attempts,
          stage: null,
          error: outcome.error,
          notBefore: failed ? null : outcome.retryAt,
        },
      });
      if (count === 0) {
        return 'stale';
      }
      await tx.media.updateMany({
        where: { id: task.mediaId },
        data: {
          downloadStatus: failed ? DownloadStatus.FAILED : DownloadStatus.PENDING,
          error: outcome.error,
        },
      });
      // Waiting again changes no counter: only a file that ends counts somewhere.
      if (failed) {
        await this.countFinished(tx, task, DownloadJobStatus.FAILED);
      }
      return failed ? 'failed' : 'waiting';
    });
  }

  /** The file can never be downloaded as it is (an unusable id or path): FAILED at once. */
  fail(task: TryRef, error: string): Promise<boolean> {
    return this.finish(task, DownloadJobStatus.FAILED, DownloadStatus.FAILED, null, error);
  }

  /** The file is not downloaded, for a reason people see (deleted on Telegram, protected). */
  skip(task: TryRef, reason: DownloadSkipReason, error: string): Promise<boolean> {
    return this.finish(task, DownloadJobStatus.SKIPPED, DownloadStatus.SKIPPED, reason, error);
  }

  /** Content protection was turned on for the chat: none of its files is downloaded any more. */
  async protectChannel(channelId: string, error: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const skipped = await tx.$queryRaw<{ media_id: string; import_job_id: string | null }[]>`
        UPDATE download_jobs d
        SET status = 'SKIPPED', reason = 'PROTECTED', stage = NULL, error = ${error},
            not_before = NULL, updated_at = now()
        WHERE d.channel_id = ${channelId}::uuid
          AND d.status IN ('PENDING', 'ACTIVE', 'FAILED')
        RETURNING d.media_id, d.import_job_id`;
      if (skipped.length > 0) {
        await tx.$executeRaw`
          UPDATE media SET download_status = 'SKIPPED', error = ${error}, updated_at = now()
          WHERE id = ANY(${skipped.map((row) => row.media_id)}::uuid[])`;
      }
      for (const importJobId of new Set(
        skipped.flatMap((row) => (row.import_job_id ? [row.import_job_id] : [])),
      )) {
        await refreshMediaCounters(tx, importJobId);
      }
      await tx.channel.updateMany({
        where: { id: channelId },
        data: {
          isProtected: true,
          syncEnabled: false,
          syncNote: SYNC_NOTES.protected,
          downloadMedia: false,
          downloadNote: error,
        },
      });
    });
  }

  /** The account can no longer read the chat: automatic downloads stop, and people see why. */
  async stopChannel(channelId: string, note: string): Promise<void> {
    await this.prisma.channel.updateMany({
      where: { id: channelId },
      data: { downloadMedia: false, downloadNote: note },
    });
  }

  /** Downloads to the location wait until `until`; `message` tells people why. */
  async pauseLocation(locationId: string, until: Date, message: string): Promise<void> {
    await this.prisma.storageLocation.updateMany({
      where: { id: locationId },
      data: { unavailableUntil: until, lastError: message, lastCheckedAt: new Date() },
    });
  }

  /** Another file of the location already stored with the same Telegram file (copied, not fetched). */
  storedTwin(task: TryRef & { fileUniqueId: string }, locationId: string) {
    return this.prisma.media.findFirst({
      where: {
        telegramFileUniqueId: task.fileUniqueId,
        storageLocationId: locationId,
        downloadStatus: DownloadStatus.DOWNLOADED,
        storageKey: { not: null },
        id: { not: task.mediaId },
      },
      select: { storageKey: true, checksum: true, size: true },
    });
  }

  /** Whether another file already uses this path in the location. */
  async keyTaken(locationId: string, key: string, mediaId: string): Promise<boolean> {
    const count = await this.prisma.media.count({
      where: { storageLocationId: locationId, storageKey: key, id: { not: mediaId } },
    });
    return count > 0;
  }

  async statusOf(downloadJobId: string): Promise<DownloadJobStatus | null> {
    const row = await this.prisma.downloadJob.findUnique({
      where: { id: downloadJobId },
      select: { status: true },
    });
    return row?.status ?? null;
  }

  /** ACTIVE tries without news since `before`; the reconciler checks them against the queue. */
  async quietTries(before: Date): Promise<TryRef[]> {
    const rows = await this.prisma.downloadJob.findMany({
      where: { status: DownloadJobStatus.ACTIVE, updatedAt: { lt: before } },
      select: { id: true, runSeq: true, mediaId: true, importJobId: true, attempts: true },
      orderBy: { updatedAt: 'asc' },
      take: 500,
    });
    return rows;
  }

  /** Download statuses of media (to tell which partial files are still needed). */
  async mediaStatuses(mediaIds: readonly string[]): Promise<Map<string, DownloadStatus>> {
    const rows = await this.prisma.media.findMany({
      where: { id: { in: [...mediaIds] } },
      select: { id: true, downloadStatus: true },
    });
    return new Map(rows.map((row) => [row.id, row.downloadStatus]));
  }

  private finish(
    task: TryRef,
    status: typeof DownloadJobStatus.FAILED | typeof DownloadJobStatus.SKIPPED,
    mediaStatus: DownloadStatus,
    reason: DownloadSkipReason | null,
    error: string,
  ): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.downloadJob.updateMany({
        where: owned(task),
        data: { status, reason, stage: null, error, notBefore: null },
      });
      if (count === 0) {
        return false;
      }
      await tx.media.updateMany({
        where: { id: task.mediaId },
        data: { downloadStatus: mediaStatus, error },
      });
      await this.countFinished(tx, task, status);
      return true;
    });
  }

  /** Adds the file that just left ACTIVE to its import job's counters. */
  private async countFinished(
    tx: Prisma.TransactionClient,
    task: TryRef,
    status: FinishedDownloadStatus,
  ): Promise<void> {
    if (task.importJobId !== null) {
      await countFinishedFile(tx, task.importJobId, task.id, status);
    }
  }
}
