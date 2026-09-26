import { ImportJobType } from './enums.js';

/**
 * BullMQ queue names. BullMQ is transport only — PostgreSQL holds the authoritative state.
 * Interactive Telegram calls (login steps) do not use a queue: see telegram-rpc.ts.
 */
export const QUEUES = {
  telegramImport: 'telegram-import',
  /** Syncs have a queue of their own, so they never wait behind a long import. */
  telegramSync: 'telegram-sync',
  mediaDownload: 'media-download',
} as const;
export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export const ALL_QUEUES: readonly QueueName[] = Object.values(QUEUES);

/** The queue that carries the runs of a job: every enqueue, removal and lookup goes through it. */
export function queueForJobType(type: ImportJobType): QueueName {
  return type === ImportJobType.SYNC ? QUEUES.telegramSync : QUEUES.telegramImport;
}

/** Redis keys shared between api and worker (BullMQ adds its own prefix to queue keys). */
export const REDIS_KEYS = {
  /** Set by the worker with a TTL; the api reports worker liveness from it. */
  workerHeartbeat: 'tam:worker:heartbeat',
  /** Lease held by the single process that owns the Telegram connection. */
  telegramOwner: 'tam:tg:owner',
  /** Present (with a TTL) while the worker re-reads the chat list from Telegram. */
  telegramDialogsRefreshing: 'tam:tg:dialogs:refreshing',
} as const;

export interface ImportJobData {
  importJobId: string;
  runSeq: number;
}

/** One try of a download (download_jobs row); a newer run number makes older tries stale. */
export interface MediaDownloadJobData {
  downloadJobId: string;
  runSeq: number;
}

/** Deterministic BullMQ job ids (no ':' and never all digits, per BullMQ rules). */
export const jobIds = {
  importRun: (importJobId: string, runSeq: number) => `ij-${importJobId}-${runSeq}`,
  mediaDownload: (downloadJobId: string, runSeq: number) => `dl-${downloadJobId}-${runSeq}`,
} as const;

/** BullMQ job name of an import or sync run (queueForJobType). */
export const IMPORT_RUN_JOB_NAME = 'import';

/** Tries of one run before its import job is marked FAILED (network trouble, Telegram errors). */
export const IMPORT_RUN_ATTEMPTS = 5;

/**
 * BullMQ options of an import run. The api enqueues runs and the worker's reconciler re-enqueues
 * lost ones, so both must use the same options; plain data keeps this package free of bullmq.
 * A run resumes where the archive stopped, so retries (30 s, 1, 2, 4 min) repeat no work.
 */
export function importRunJobOptions(importJobId: string, runSeq: number) {
  return {
    jobId: jobIds.importRun(importJobId, runSeq),
    attempts: IMPORT_RUN_ATTEMPTS,
    backoff: { type: 'exponential', delay: 30_000 },
    removeOnComplete: true,
    // Kept a week, so the reconciler (and people) can see why a run failed.
    removeOnFail: { age: 7 * 24 * 60 * 60 },
  } as const;
}

/** BullMQ job name of one download try (queue QUEUES.mediaDownload). */
export const DOWNLOAD_JOB_NAME = 'download';

/**
 * BullMQ options of one download try. The worker's scheduler hands a few tries at a time to the
 * queue; retries and their delays are kept in download_jobs, so BullMQ never retries by itself.
 */
export function downloadJobOptions(downloadJobId: string, runSeq: number) {
  return {
    jobId: jobIds.mediaDownload(downloadJobId, runSeq),
    attempts: 1,
    removeOnComplete: true,
    // Kept a day, so the reconciler can tell a failed try from a lost one.
    removeOnFail: { age: 24 * 60 * 60 },
  } as const;
}
