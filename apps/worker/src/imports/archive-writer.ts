import { Injectable } from '@nestjs/common';
import type { Prisma } from '@tam/database';
import { PrismaService } from '@tam/database/nest';
import { JobStatus } from '@tam/shared';
import type { Message } from '@tam/telegram';
import {
  editableColumns,
  isArchivable,
  isArchivableMedia,
  isNewerEdit,
  toMediaRow,
  toMessageRow,
} from './archive-rows.js';
import { ArchiveRangeMovedError, ImportInterruptedError } from './import-errors.js';

/**
 * The contiguous range of a channel's history the archive holds: every message with
 * backfillCursorId ≤ id ≤ headMessageId was read (and stored unless the archive never keeps it).
 */
export interface ArchiveRange {
  headMessageId: number | null;
  backfillCursorId: number | null;
}

export interface ChannelPosition extends ArchiveRange {
  backfillComplete: boolean;
}

export interface PageWrite {
  /** The run writing the page; the write is refused unless it still owns the job. */
  job: { id: string; runSeq: number };
  channelId: string;
  /** The messages of the page the job keeps (FROM_DATE drops the older ones). */
  messages: readonly Message[];
  /** The channel's range the page was read against; the write fails if it moved meanwhile. */
  expected: ArchiveRange;
  /** Where the channel's range stands once the page is stored. */
  next: Partial<ChannelPosition>;
}

export interface PageResult {
  /** Messages newly added to the archive. */
  added: number;
  /** Messages the archive never keeps (content protection, auto-delete timer). */
  skipped: number;
}

/** Stores a page well within the transaction timeout even on a slow disk. */
const TRANSACTION_OPTIONS = { timeout: 30_000, maxWait: 5_000 } as const;

/**
 * Writes one page of history in a single transaction: the job's progress, the channel's range,
 * the messages, their media and a download job per media file. Either all of it lands or none,
 * so a run that stops anywhere resumes exactly after the last stored page, and the unique keys
 * (channel + message id, message + file) make a repeated page add nothing.
 */
@Injectable()
export class ArchiveWriter {
  constructor(private readonly prisma: PrismaService) {}

  writePage(page: PageWrite): Promise<PageResult> {
    return this.prisma.$transaction(async (tx) => {
      // First: counting the page proves (and locks) that this run still owns the job. A pause,
      // cancel or newer run makes it match nothing, and the whole page rolls back.
      const owned = await tx.importJob.updateMany({
        where: { id: page.job.id, runSeq: page.job.runSeq, status: JobStatus.RUNNING },
        data: { processedMessages: { increment: page.messages.length }, statusDetail: null },
      });
      if (owned.count === 0) {
        throw new ImportInterruptedError();
      }
      const moved = await tx.channel.updateMany({
        where: {
          id: page.channelId,
          headMessageId: page.expected.headMessageId,
          backfillCursorId: page.expected.backfillCursorId,
        },
        data: page.next,
      });
      if (moved.count === 0) {
        throw new ArchiveRangeMovedError();
      }
      const result = await storeMessages(tx, page.channelId, page.job.id, page.messages);
      await refreshMediaCounters(tx, page.job.id);
      return result;
    }, TRANSACTION_OPTIONS);
  }
}

async function storeMessages(
  tx: Prisma.TransactionClient,
  channelId: string,
  importJobId: string,
  messages: readonly Message[],
): Promise<PageResult> {
  const kept = messages.filter(isArchivable);
  const skipped = messages.length - kept.length;
  if (kept.length === 0) {
    return { added: 0, skipped };
  }

  const { count: added } = await tx.message.createMany({
    data: kept.map((message) => toMessageRow(channelId, message)),
    skipDuplicates: true,
  });
  // The whole page, not only the new rows: a message stored before still gets its media and
  // download job, and an edit made since is applied.
  const rows = await tx.message.findMany({
    where: { channelId, telegramMessageId: { in: kept.map((message) => Number(message.id)) } },
    select: { id: true, telegramMessageId: true, editDate: true },
  });
  const byTelegramId = new Map(rows.map((row) => [row.telegramMessageId, row]));

  const media: Prisma.MediaCreateManyInput[] = [];
  for (const message of kept) {
    const row = byTelegramId.get(Number(message.id));
    if (!row) {
      continue;
    }
    if (isNewerEdit(message.editDate, row.editDate)) {
      await tx.message.update({ where: { id: row.id }, data: editableColumns(message) });
    }
    media.push(...message.media.filter(isArchivableMedia).map((item) => toMediaRow(row.id, item)));
  }
  if (media.length > 0) {
    await tx.media.createMany({ data: media, skipDuplicates: true });
    const stored = await tx.media.findMany({
      where: { messageId: { in: rows.map((row) => row.id) } },
      select: { id: true },
    });
    await tx.downloadJob.createMany({
      data: stored.map((item) => ({ mediaId: item.id, importJobId })),
      skipDuplicates: true,
    });
  }
  return { added, skipped };
}

/**
 * Recomputes the job's media counters from its download jobs. They are never incremented, so a
 * repeated page or a retried download can never count twice.
 */
export async function refreshMediaCounters(
  tx: Prisma.TransactionClient,
  importJobId: string,
): Promise<void> {
  await tx.$executeRaw`
    UPDATE import_jobs AS j
    SET total_media = c.total,
        downloaded_files = c.downloaded,
        failed_files = c.failed,
        skipped_files = c.skipped,
        total_bytes = c.total_bytes,
        downloaded_bytes = c.downloaded_bytes
    FROM (
      SELECT count(*)::int AS total,
             count(*) FILTER (WHERE d.status = 'COMPLETED')::int AS downloaded,
             count(*) FILTER (WHERE d.status = 'FAILED')::int AS failed,
             count(*) FILTER (WHERE d.status = 'SKIPPED')::int AS skipped,
             coalesce(sum(m.size), 0)::bigint AS total_bytes,
             coalesce(sum(m.size) FILTER (WHERE d.status = 'COMPLETED'), 0)::bigint AS downloaded_bytes
      FROM download_jobs d
      JOIN media m ON m.id = d.media_id
      WHERE d.import_job_id = ${importJobId}::uuid
    ) AS c
    WHERE j.id = ${importJobId}::uuid`;
}
