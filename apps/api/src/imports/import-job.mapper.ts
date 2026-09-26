import type { Channel, ImportJob } from '@tam/database';
import type { ActiveDownloadDto, ImportJobDto } from '@tam/shared';

/** What import job queries load next to the row (`include`), so the DTO can name the channel. */
export const IMPORT_JOB_INCLUDE = { channel: true } as const;

export type ImportJobWithChannel = ImportJob & { channel: Channel };

/**
 * BIGINT counters become numbers (byte totals stay far below 2^53); ids travel as strings.
 * `activeFiles` are the job's downloads running now (activeFilesOf).
 */
export function toImportJobDto(
  job: ImportJobWithChannel,
  activeFiles: ActiveDownloadDto[] = [],
): ImportJobDto {
  return {
    id: job.id,
    channelId: job.channelId,
    channel: {
      id: job.channel.id,
      telegramChatId: job.channel.telegramChatId.toString(),
      title: job.channel.title,
      username: job.channel.username,
      type: job.channel.type,
    },
    parentImportJobId: job.parentImportJobId,
    type: job.type,
    origin: job.origin,
    mode: job.mode,
    fromDate: job.fromDate?.toISOString() ?? null,
    status: job.status,
    phase: job.phase,
    totalMessages: job.totalMessages,
    processedMessages: job.processedMessages,
    totalMedia: job.totalMedia,
    downloadedFiles: job.downloadedFiles,
    failedFiles: job.failedFiles,
    skippedFiles: job.skippedFiles,
    totalBytes: Number(job.totalBytes),
    downloadedBytes: Number(job.downloadedBytes),
    activeFiles,
    statusDetail: job.statusDetail,
    error: job.error,
    startedAt: job.startedAt?.toISOString() ?? null,
    messagesCompletedAt: job.messagesCompletedAt?.toISOString() ?? null,
    completedAt: job.completedAt?.toISOString() ?? null,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
  };
}
