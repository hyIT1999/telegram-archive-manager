import type { DownloadJob, Media, Message, StorageLocation } from '@tam/database';
import type { MediaDto, MediaSummaryDto } from '@tam/shared';

/** What media queries load next to the row, so the DTO can say where and how far. */
export const MEDIA_INCLUDE = {
  message: { select: { channelId: true, telegramMessageId: true, telegramDate: true } },
  downloadJob: true,
  storageLocation: true,
} as const;

export type MediaWithDetails = Media & {
  message: Pick<Message, 'channelId' | 'telegramMessageId' | 'telegramDate'>;
  downloadJob: DownloadJob | null;
  storageLocation: StorageLocation | null;
};

/** A file as lists show it; BIGINT sizes become numbers. */
export function toMediaSummaryDto(media: Media): MediaSummaryDto {
  return {
    id: media.id,
    type: media.type,
    fileName: media.filename,
    mimeType: media.mimeType,
    size: media.size === null ? null : Number(media.size),
    width: media.width,
    height: media.height,
    duration: media.duration,
    downloadStatus: media.downloadStatus,
    downloadProgress: media.downloadProgress,
    hasThumbnail: media.thumbnailKey !== null,
  };
}

/** BIGINT sizes become numbers; server paths and Telegram file ids never leave the server. */
export function toMediaDto(media: MediaWithDetails): MediaDto {
  const job = media.downloadJob;
  const location = media.storageLocation;
  return {
    ...toMediaSummaryDto(media),
    messageId: media.messageId,
    channelId: media.message.channelId,
    telegramMessageId: media.message.telegramMessageId,
    postedAt: media.message.telegramDate.toISOString(),
    downloadedBytes: Number(media.downloadedBytes),
    skipReason: job?.status === 'SKIPPED' ? job.reason : null,
    stage: job?.status === 'ACTIVE' ? job.stage : null,
    requested: (job?.requestedAt ?? null) !== null,
    attempts: job?.attempts ?? 0,
    error: media.error,
    checksum: media.checksum,
    storageLocation: location
      ? {
          id: location.id,
          kind: location.kind,
          name: location.name,
          displayPath: location.displayPath,
        }
      : null,
    storageKey: media.storageKey,
    updatedAt: media.updatedAt.toISOString(),
  };
}
