import type {
  DownloadSkipReason,
  DownloadStage,
  DownloadStatus,
  MediaType,
  StorageKind,
} from '../enums.js';
import type { ChannelStorageLocationDto } from './channels.js';

/** A media file as lists show it (inside MessageSummaryDto). */
export interface MediaSummaryDto {
  id: string;
  type: MediaType;
  fileName: string | null;
  mimeType: string | null;
  /** Bytes, as Telegram reports them. */
  size: number | null;
  width: number | null;
  height: number | null;
  /** Seconds. */
  duration: number | null;
  downloadStatus: DownloadStatus;
  /** 0–100. */
  downloadProgress: number;
  /** Telegram's small preview is in the thumbnail cache (GET /api/media/:id/thumbnail). */
  hasThumbnail: boolean;
}

/** GET /api/media/:id — one media file of the archive. Never includes server paths. */
export interface MediaDto extends MediaSummaryDto {
  messageId: string;
  channelId: string;
  telegramMessageId: number;
  /** When the message was posted on Telegram. */
  postedAt: string;
  downloadedBytes: number;
  /** Why the file is not downloaded, when it was skipped. */
  skipReason: DownloadSkipReason | null;
  /** What the running download does. */
  stage: DownloadStage | null;
  /** Requested one by one: downloads even while the channel's automatic downloads are off. */
  requested: boolean;
  /** Failed tries so far. */
  attempts: number;
  error: string | null;
  /** SHA-256 of the stored file (lowercase hex). */
  checksum: string | null;
  /** Where the file is stored, once downloaded. */
  storageLocation: ChannelStorageLocationDto | null;
  /** Path inside that location, e.g. "Physics (-100123)/2026-09/42 - notes.pdf". */
  storageKey: string | null;
  updatedAt: string;
}

/** Files of a channel per download status. ACTIVE files are queued or downloading. */
export interface DownloadCountsDto {
  pending: number;
  active: number;
  downloaded: number;
  failed: number;
  skipped: number;
  cancelled: number;
}

/** A file being downloaded (or queued for it) right now. */
export interface ActiveDownloadDto {
  mediaId: string;
  /** The file name, or the name the stored file gets ("42.jpg") when Telegram has none. */
  name: string;
  type: MediaType;
  size: number | null;
  downloadedBytes: number;
  /** 0–100. */
  progress: number;
  stage: DownloadStage | null;
  requested: boolean;
  updatedAt: string;
}

/** Where a channel's files go, and whether that place takes files right now. */
export interface DownloadLocationDto {
  id: string;
  kind: StorageKind;
  name: string;
  displayPath: string;
  /** Null when the backend does not say (e.g. unlimited Drive plans) or could not be asked. */
  freeBytes: number | null;
  /** Downloads to this location wait until then; lastError says why. */
  unavailableUntil: string | null;
  lastError: string | null;
}

/** GET /api/channels/:id/downloads — the channel (and its old basic group, if any). */
export interface ChannelDownloadsDto {
  channelId: string;
  /** Files download automatically (within the download settings). */
  downloadMedia: boolean;
  /** Why automatic downloads stopped by themselves, e.g. the chat can no longer be read. */
  downloadNote: string | null;
  /** Every download is paused in Settings. */
  paused: boolean;
  files: DownloadCountsDto;
  bytes: {
    total: number;
    downloaded: number;
    /** Still to download: files waiting or in progress. */
    remaining: number;
  };
  active: ActiveDownloadDto[];
  /** Null when no location applies (none chosen and no default). */
  location: DownloadLocationDto | null;
  /**
   * Whether the location has room for the remaining files while keeping the server's minimum
   * free space; null when it cannot tell.
   */
  fits: boolean | null;
}

/** POST /api/channels/:id/downloads/retry */
export interface RetryDownloadsDto {
  /** Failed files queued again. */
  queued: number;
}
