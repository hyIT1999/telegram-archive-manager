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

/** Why a file is not downloaded (download_jobs.reason, with status SKIPPED). */
export const DownloadSkipReason = {
  /** Outside the automatic download settings (type or size); downloads when requested. */
  POLICY: 'POLICY',
  /** The message was deleted on Telegram, or its file was replaced. */
  NOT_AVAILABLE: 'NOT_AVAILABLE',
  /** Content protection was turned on for the chat. */
  PROTECTED: 'PROTECTED',
} as const;
export type DownloadSkipReason = (typeof DownloadSkipReason)[keyof typeof DownloadSkipReason];

/** What a running download does right now (download_jobs.stage). */
export const DownloadStage = {
  /** Reading the file from Telegram. */
  FETCHING: 'FETCHING',
  /** Checking its size and SHA-256. */
  VERIFYING: 'VERIFYING',
  /** Writing it to the storage location (an upload for Google Drive). */
  STORING: 'STORING',
} as const;
export type DownloadStage = (typeof DownloadStage)[keyof typeof DownloadStage];

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

/** Why a job runs. Imports are always asked for; syncs also start on their own. */
export const JobOrigin = {
  /** Someone asked for it. */
  MANUAL: 'MANUAL',
  /** The scheduled check found new messages. */
  SCHEDULE: 'SCHEDULE',
  /** Telegram announced new messages. */
  TELEGRAM_UPDATE: 'TELEGRAM_UPDATE',
} as const;
export type JobOrigin = (typeof JobOrigin)[keyof typeof JobOrigin];

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

/**
 * What a storage location is: a folder on the server or in Google Drive (where media files are
 * downloaded), or a Telegram chat of the user's that receives backup copies of messages.
 */
export const StorageKind = {
  LOCAL: 'LOCAL',
  GOOGLE_DRIVE: 'GOOGLE_DRIVE',
  TELEGRAM: 'TELEGRAM',
} as const;
export type StorageKind = (typeof StorageKind)[keyof typeof StorageKind];

/** The kinds media files are downloaded to; a Telegram backup chat is never one of them. */
export const DOWNLOAD_STORAGE_KINDS: readonly StorageKind[] = [
  StorageKind.LOCAL,
  StorageKind.GOOGLE_DRIVE,
];

/** Where the backup copy of a message stands in its backup chat (message_backups.status). */
export const BackupStatus = {
  PENDING: 'PENDING',
  ACTIVE: 'ACTIVE',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  SKIPPED: 'SKIPPED',
} as const;
export type BackupStatus = (typeof BackupStatus)[keyof typeof BackupStatus];

/** What a running backup does right now (message_backups.stage). */
export const BackupStage = {
  /** Reading the source message and opening its file. */
  FETCHING: 'FETCHING',
  /** Uploading the file to Telegram as it streams from its source. */
  UPLOADING: 'UPLOADING',
  /** Sending the new message. */
  SENDING: 'SENDING',
} as const;
export type BackupStage = (typeof BackupStage)[keyof typeof BackupStage];

/** Why a message is not backed up (with status SKIPPED). */
export const BackupSkipReason = {
  /** The source message or its file is gone, and no downloaded copy exists. */
  NOT_AVAILABLE: 'NOT_AVAILABLE',
  /** Content protection was turned on for the source chat. */
  PROTECTED: 'PROTECTED',
  /** A poll, a location or another kind of message that cannot be recreated. */
  UNSUPPORTED: 'UNSUPPORTED',
  /** Larger than Telegram accepts from this account (2000 MiB, 4000 MiB with Premium). */
  TOO_LARGE: 'TOO_LARGE',
} as const;
export type BackupSkipReason = (typeof BackupSkipReason)[keyof typeof BackupSkipReason];
