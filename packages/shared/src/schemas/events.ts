import { z } from 'zod';
import { ImportJobPhase, JobStatus, TelegramAuthState } from '../enums.js';

/**
 * Events published by the worker on Redis (REDIS_KEYS.eventsChannel) and relayed
 * by the api over SSE (GET /api/events). Payload numbers are plain JSON numbers.
 */
export const importProgressEventSchema = z.object({
  type: z.literal('import.progress'),
  jobId: z.uuid(),
  channelId: z.uuid(),
  status: z.enum(JobStatus),
  phase: z.enum(ImportJobPhase),
  processedMessages: z.number().int().nonnegative(),
  totalMessages: z.number().int().nonnegative().nullable(),
  /** FROM_DATE imports only know an estimate of the total. */
  totalIsEstimate: z.boolean(),
  /** Grows while history is still being read (UI shows "+"). */
  totalMedia: z.number().int().nonnegative(),
  downloadedFiles: z.number().int().nonnegative(),
  failedFiles: z.number().int().nonnegative(),
  skippedFiles: z.number().int().nonnegative(),
  downloadedBytes: z.number().nonnegative(),
  totalBytes: z.number().nonnegative(),
  currentFile: z.string().nullable(),
  ts: z.iso.datetime(),
});
export type ImportProgressEvent = z.infer<typeof importProgressEventSchema>;

export const mediaProgressEventSchema = z.object({
  type: z.literal('media.progress'),
  mediaId: z.uuid(),
  importJobId: z.uuid().nullable(),
  downloadedBytes: z.number().nonnegative(),
  totalBytes: z.number().nonnegative().nullable(),
  progress: z.number().int().min(0).max(100),
  ts: z.iso.datetime(),
});
export type MediaProgressEvent = z.infer<typeof mediaProgressEventSchema>;

export const telegramAuthEventSchema = z.object({
  type: z.literal('telegram.auth'),
  state: z.enum(TelegramAuthState),
  ts: z.iso.datetime(),
});
export type TelegramAuthEvent = z.infer<typeof telegramAuthEventSchema>;

export const appEventSchema = z.discriminatedUnion('type', [
  importProgressEventSchema,
  mediaProgressEventSchema,
  telegramAuthEventSchema,
]);
export type AppEvent = z.infer<typeof appEventSchema>;
