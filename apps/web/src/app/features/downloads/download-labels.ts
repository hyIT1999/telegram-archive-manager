import type { DownloadSkipReason, DownloadStage, MediaType } from '../../shared/models';

/** Media types in the order Settings lists them, with what people call them. */
export const MEDIA_TYPE_OPTIONS: readonly { type: MediaType; label: string }[] = [
  { type: 'VIDEO', label: 'Videos' },
  { type: 'DOCUMENT', label: 'Documents' },
  { type: 'PHOTO', label: 'Photos' },
  { type: 'AUDIO', label: 'Audio' },
  { type: 'VOICE', label: 'Voice messages' },
  { type: 'ANIMATION', label: 'GIFs' },
  { type: 'VIDEO_NOTE', label: 'Round videos' },
  { type: 'STICKER', label: 'Stickers' },
];

export const DOWNLOAD_STAGE_LABELS: Readonly<Record<DownloadStage, string>> = {
  FETCHING: 'Downloading from Telegram',
  VERIFYING: 'Checking the file',
  STORING: 'Saving to the storage location',
};

export const SKIP_REASON_LABELS: Readonly<Record<DownloadSkipReason, string>> = {
  POLICY: 'Not downloaded automatically (Settings)',
  NOT_AVAILABLE: 'Deleted or replaced on Telegram',
  PROTECTED: 'Content protection is on',
};

/** A reading of how far a file got, to tell the speed from two readings. */
export interface ProgressReading {
  bytes: number;
  /** Milliseconds (Date.now()). */
  at: number;
}

/** Bytes per second between two readings of the same file; null when it cannot tell. */
export function speedBetween(
  previous: ProgressReading | undefined,
  current: ProgressReading,
): number | null {
  if (!previous || current.at <= previous.at || current.bytes < previous.bytes) {
    return null;
  }
  return ((current.bytes - previous.bytes) * 1000) / (current.at - previous.at);
}

/** Seconds left at `bytesPerSecond`; null when unknown or not moving. */
export function secondsLeft(remainingBytes: number, bytesPerSecond: number | null): number | null {
  if (bytesPerSecond === null || bytesPerSecond <= 0 || remainingBytes < 0) {
    return null;
  }
  return Math.ceil(remainingBytes / bytesPerSecond);
}

/** "45 s", "12 min", "3 h 20 min", "2 d 5 h": how long something still takes. */
export function durationText(seconds: number): string {
  if (seconds < 60) {
    return `${Math.max(1, Math.round(seconds))} s`;
  }
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return `${minutes} min`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 48) {
    const rest = minutes % 60;
    return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
  }
  const days = Math.floor(hours / 24);
  const rest = hours % 24;
  return rest === 0 ? `${days} d` : `${days} d ${rest} h`;
}
