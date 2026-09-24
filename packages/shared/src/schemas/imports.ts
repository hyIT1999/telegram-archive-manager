import { z } from 'zod';
import type { ImportJobPhase, ImportJobType, ImportMode, JobStatus } from '../enums.js';
import { isoDateOrDateTimeSchema } from './common.js';

export const importRequestSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('ALL') }),
  z.object({ mode: z.literal('FROM_DATE'), fromDate: isoDateOrDateTimeSchema }),
]);
export type ImportRequest = z.infer<typeof importRequestSchema>;

export interface ImportJobDto {
  id: string;
  channelId: string;
  parentImportJobId: string | null;
  type: ImportJobType;
  mode: ImportMode;
  fromDate: string | null;
  status: JobStatus;
  phase: ImportJobPhase;
  totalMessages: number | null;
  processedMessages: number;
  totalMedia: number;
  downloadedFiles: number;
  failedFiles: number;
  skippedFiles: number;
  totalBytes: number;
  downloadedBytes: number;
  currentFile: string | null;
  error: string | null;
  startedAt: string | null;
  messagesCompletedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
