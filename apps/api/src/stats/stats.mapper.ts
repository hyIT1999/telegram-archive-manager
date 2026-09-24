import {
  DownloadStatus,
  MEDIA_CATEGORIES,
  type MediaCategory,
  type MediaType,
  type StatsDto,
} from '@tam/shared';

export interface MediaTypeCount {
  type: MediaType;
  count: number;
}

export interface DownloadStatusTotals {
  status: DownloadStatus;
  count: number;
  /** Sum of media.size for this status (0 when every size is unknown). */
  bytes: bigint;
}

export interface StatsAggregates {
  channels: number;
  messages: number;
  mediaByType: readonly MediaTypeCount[];
  mediaByStatus: readonly DownloadStatusTotals[];
}

function countCategory(category: MediaCategory, rows: readonly MediaTypeCount[]): number {
  const types: readonly MediaType[] = MEDIA_CATEGORIES[category];
  return rows.filter((row) => types.includes(row.type)).reduce((sum, row) => sum + row.count, 0);
}

function statusTotals(
  status: DownloadStatus,
  rows: readonly DownloadStatusTotals[],
): DownloadStatusTotals {
  return rows.find((row) => row.status === status) ?? { status, count: 0, bytes: 0n };
}

/** Builds the dashboard totals from grouped counts; every STATS_KEYS entry is always present. */
export function toStatsDto(aggregates: StatsAggregates): StatsDto {
  const { mediaByType, mediaByStatus } = aggregates;
  const downloaded = statusTotals(DownloadStatus.DOWNLOADED, mediaByStatus);
  return {
    channels: aggregates.channels,
    messages: aggregates.messages,
    videos: countCategory('videos', mediaByType),
    images: countCategory('images', mediaByType),
    documents: countCategory('documents', mediaByType),
    audio: countCategory('audio', mediaByType),
    storageBytes: Number(downloaded.bytes),
    downloaded: downloaded.count,
    pending:
      statusTotals(DownloadStatus.PENDING, mediaByStatus).count +
      statusTotals(DownloadStatus.DOWNLOADING, mediaByStatus).count,
    failed: statusTotals(DownloadStatus.FAILED, mediaByStatus).count,
  };
}
