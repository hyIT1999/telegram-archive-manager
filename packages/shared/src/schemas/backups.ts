import { z } from 'zod';
import type { BackupSkipReason, BackupStage, BackupStatus, MessageType } from '../enums.js';

/** Messages of a channel per backup status. ACTIVE messages are being backed up right now. */
export interface BackupCountsDto {
  pending: number;
  active: number;
  completed: number;
  failed: number;
  skipped: number;
}

/** A message being backed up right now. */
export interface ActiveBackupDto {
  messageId: string;
  telegramMessageId: number;
  /** The file name, or "Message 42" for a text message. */
  name: string;
  type: MessageType;
  /** The file's size; null for text. */
  size: number | null;
  uploadedBytes: number;
  stage: BackupStage | null;
  /** Asked for with "Back up now". */
  requested: boolean;
  updatedAt: string;
}

/** A message whose backup failed, or whose copy Verify found wrong. */
export interface BackupProblemDto {
  messageId: string;
  telegramMessageId: number;
  name: string;
  error: string | null;
  attempts: number;
  at: string | null;
}

/** The backup chat of a channel, and whether it takes messages right now. */
export interface BackupChatStateDto {
  id: string;
  name: string;
  displayPath: string;
  /** Marked chat id (-100…), for t.me links. */
  telegramChatId: string;
  isForum: boolean;
  /** Backups to it wait until then; lastError says why. */
  unavailableUntil: string | null;
  lastError: string | null;
}

/** The outcome of the last Verify of a channel's backup. */
export interface BackupVerifyDto {
  /** A Verify is under way. */
  running: boolean;
  /** When a copy of the channel was last checked; null if never. */
  verifiedAt: string | null;
  /** Copies found as expected, and copies with a problem, as last checked. */
  ok: number;
  problems: number;
  /** Some of the problems, newest first. */
  problemSamples: BackupProblemDto[];
}

/** GET /api/channels/:id/backup — the channel (and its old basic group, if any). */
export interface ChannelBackupDto {
  channelId: string;
  /** Every message is backed up automatically, new ones included. */
  backupEnabled: boolean;
  /** Why backups stopped by themselves, e.g. the backup chat refused posts. */
  backupNote: string | null;
  /** Every backup is paused in Settings. */
  paused: boolean;
  /** Null until a backup chat is chosen. */
  chat: BackupChatStateDto | null;
  messages: BackupCountsDto;
  bytes: {
    /** Files of the messages that are, or will be, backed up. */
    total: number;
    /** Files already in the backup chat. */
    uploaded: number;
    /** Still to upload: files waiting or in progress. */
    remaining: number;
  };
  active: ActiveBackupDto[];
  /** The latest failures. */
  failures: BackupProblemDto[];
  verify: BackupVerifyDto;
}

/** POST /api/channels/:id/backup/retry */
export interface RetryBackupsDto {
  /** Failed messages queued again. */
  queued: number;
}

/**
 * POST /api/messages/:id/backup — "Back up now", or with `force` "Back up again". The body may be
 * left out.
 */
export const requestBackupRequestSchema = z
  .object({
    /** Send a new copy although one exists. */
    force: z.boolean().default(false),
    /** With `force`: delete the earlier copy from the backup chat once the new one is sent. */
    replacePrevious: z.boolean().default(true),
  })
  .prefault({});
export type RequestBackupRequest = z.infer<typeof requestBackupRequestSchema>;

/** The backup of one message in one backup chat (GET /api/messages/:id). */
export interface MessageBackupDto {
  chat: { id: string; name: string; displayPath: string };
  status: BackupStatus;
  stage: BackupStage | null;
  skipReason: BackupSkipReason | null;
  error: string | null;
  attempts: number;
  /** The file's size; null for text. */
  size: number | null;
  uploadedBytes: number;
  /** Asked for with "Back up now" and still to run. */
  requested: boolean;
  /** The copy in Telegram, for people who can read the backup chat. */
  url: string | null;
  completedAt: string | null;
  verifiedAt: string | null;
  /** What Verify found wrong with the copy; null when it was found as expected. */
  verifyError: string | null;
}
