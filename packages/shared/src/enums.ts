/**
 * Domain enums shared by web, api and worker.
 * Values mirror the PostgreSQL enums declared in packages/database/prisma/schema.prisma.
 */

export const ChatType = {
  CHANNEL: 'CHANNEL',
  SUPERGROUP: 'SUPERGROUP',
  GROUP: 'GROUP',
} as const;
export type ChatType = (typeof ChatType)[keyof typeof ChatType];

export const MessageType = {
  TEXT: 'TEXT',
  PHOTO: 'PHOTO',
  VIDEO: 'VIDEO',
  DOCUMENT: 'DOCUMENT',
  AUDIO: 'AUDIO',
  VOICE: 'VOICE',
  ANIMATION: 'ANIMATION',
  VIDEO_NOTE: 'VIDEO_NOTE',
  STICKER: 'STICKER',
  POLL: 'POLL',
  WEBPAGE: 'WEBPAGE',
  SERVICE: 'SERVICE',
  OTHER: 'OTHER',
} as const;
export type MessageType = (typeof MessageType)[keyof typeof MessageType];

export const MediaType = {
  PHOTO: 'PHOTO',
  VIDEO: 'VIDEO',
  DOCUMENT: 'DOCUMENT',
  AUDIO: 'AUDIO',
  VOICE: 'VOICE',
  ANIMATION: 'ANIMATION',
  VIDEO_NOTE: 'VIDEO_NOTE',
  STICKER: 'STICKER',
} as const;
export type MediaType = (typeof MediaType)[keyof typeof MediaType];

/** What the UI shows for a media file. */
export const DownloadStatus = {
  PENDING: 'PENDING',
  DOWNLOADING: 'DOWNLOADING',
  DOWNLOADED: 'DOWNLOADED',
  FAILED: 'FAILED',
  SKIPPED: 'SKIPPED',
  CANCELLED: 'CANCELLED',
} as const;
export type DownloadStatus = (typeof DownloadStatus)[keyof typeof DownloadStatus];

/** Attempt ledger state of a download (download_jobs.status). */
export const DownloadJobStatus = {
  PENDING: 'PENDING',
  ACTIVE: 'ACTIVE',
  PAUSED: 'PAUSED',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  SKIPPED: 'SKIPPED',
  CANCELLED: 'CANCELLED',
} as const;
export type DownloadJobStatus = (typeof DownloadJobStatus)[keyof typeof DownloadJobStatus];

export const JobStatus = {
  PENDING: 'PENDING',
  RUNNING: 'RUNNING',
  PAUSED: 'PAUSED',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
} as const;
export type JobStatus = (typeof JobStatus)[keyof typeof JobStatus];

/** Statuses that hold the "one active import job per channel" slot. */
export const ACTIVE_JOB_STATUSES: readonly JobStatus[] = [
  JobStatus.PENDING,
  JobStatus.RUNNING,
  JobStatus.PAUSED,
];

export const ImportJobType = {
  IMPORT: 'IMPORT',
  SYNC: 'SYNC',
} as const;
export type ImportJobType = (typeof ImportJobType)[keyof typeof ImportJobType];

export const ImportMode = {
  ALL: 'ALL',
  FROM_DATE: 'FROM_DATE',
} as const;
export type ImportMode = (typeof ImportMode)[keyof typeof ImportMode];

export const ImportJobPhase = {
  HISTORY: 'HISTORY',
  MEDIA: 'MEDIA',
  DONE: 'DONE',
} as const;
export type ImportJobPhase = (typeof ImportJobPhase)[keyof typeof ImportJobPhase];

export const TelegramAuthState = {
  LOGGED_OUT: 'LOGGED_OUT',
  CODE_SENT: 'CODE_SENT',
  PASSWORD_REQUIRED: 'PASSWORD_REQUIRED',
  READY: 'READY',
} as const;
export type TelegramAuthState = (typeof TelegramAuthState)[keyof typeof TelegramAuthState];

/** Where a storage location writes: a folder on the server, or a folder in Google Drive. */
export const StorageKind = {
  LOCAL: 'LOCAL',
  GOOGLE_DRIVE: 'GOOGLE_DRIVE',
} as const;
export type StorageKind = (typeof StorageKind)[keyof typeof StorageKind];
