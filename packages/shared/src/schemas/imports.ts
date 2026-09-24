import { z } from 'zod';
import {
  type ChatType,
  type ImportJobPhase,
  type ImportJobType,
  type ImportMode,
  JobStatus,
} from '../enums.js';
import { csvList, cursorQuerySchema, isoDateOrDateTimeSchema } from './common.js';

/** Clocks and time zones differ a little between browser and server; a day of slack covers it. */
const FUTURE_SLACK_MS = 24 * 60 * 60_000;

/** A date only makes sense up to now: a FROM_DATE import keeps messages sent on or after it. */
const fromDateSchema = isoDateOrDateTimeSchema.refine(
  (value) => new Date(value).getTime() <= Date.now() + FUTURE_SLACK_MS,
  'Pick a date that is not in the future',
);

/** POST /api/channels/:id/import — everything, or the messages sent since a date. */
export const importRequestSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('ALL') }),
  z.object({ mode: z.literal('FROM_DATE'), fromDate: fromDateSchema }),
]);
export type ImportRequest = z.infer<typeof importRequestSchema>;

/** GET /api/import-jobs — newest first; filter by channel and/or status (`RUNNING,PAUSED`). */
export const importJobListQuerySchema = cursorQuerySchema.extend({
  channelId: z.uuid().optional(),
  status: csvList(z.enum(JobStatus)).optional(),
});
export type ImportJobListQuery = z.infer<typeof importJobListQuerySchema>;

/** The channel a job imports, as listings show it. */
export interface ImportJobChannelDto {
  id: string;
  telegramChatId: string;
  title: string;
  username: string | null;
  type: ChatType;
}

export interface ImportJobDto {
  id: string;
  channelId: string;
  channel: ImportJobChannelDto;
  parentImportJobId: string | null;
  type: ImportJobType;
  mode: ImportMode;
  fromDate: string | null;
  status: JobStatus;
  phase: ImportJobPhase;
  /**
   * Messages this job is expected to read: Telegram's count while the job runs (an estimate for
   * FROM_DATE and for channels imported before), the exact number once it completed.
   */
  totalMessages: number | null;
  /** Messages read so far, including the ones skipped (content protection, auto-delete timer). */
  processedMessages: number;
  totalMedia: number;
  downloadedFiles: number;
  failedFiles: number;
  skippedFiles: number;
  totalBytes: number;
  downloadedBytes: number;
  currentFile: string | null;
  /** What an unfinished job waits for, e.g. "Telegram asked to wait 45 s". */
  statusDetail: string | null;
  error: string | null;
  startedAt: string | null;
  messagesCompletedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
