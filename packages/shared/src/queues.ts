/**
 * BullMQ queue names. BullMQ is transport only — PostgreSQL holds the authoritative state.
 * Interactive Telegram calls (login steps) do not use a queue: see telegram-rpc.ts.
 */
export const QUEUES = {
  telegramImport: 'telegram-import',
  mediaDownload: 'media-download',
  thumbnailGeneration: 'thumbnail-generation',
  metadataProcessing: 'metadata-processing',
} as const;
export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export const ALL_QUEUES: readonly QueueName[] = Object.values(QUEUES);

/** Redis keys and channels shared between api and worker (BullMQ adds its own prefix to queue keys). */
export const REDIS_KEYS = {
  /** Set by the worker with a TTL; the api reports worker liveness from it. */
  workerHeartbeat: 'tam:worker:heartbeat',
  /** Lease held by the single process that owns the Telegram connection. */
  telegramOwner: 'tam:tg:owner',
  /** Present (with a TTL) while the worker re-reads the chat list from Telegram. */
  telegramDialogsRefreshing: 'tam:tg:dialogs:refreshing',
  /** Pub/sub channel for progress and state events (worker → api → SSE). */
  eventsChannel: 'tam:events',
} as const;

export interface ImportJobData {
  importJobId: string;
  runSeq: number;
}

export interface MediaDownloadJobData {
  mediaId: string;
}

export interface ThumbnailJobData {
  mediaId: string;
}

export interface MetadataJobData {
  mediaId: string;
}

/** Deterministic BullMQ job ids (no ':' and never all digits, per BullMQ rules). */
export const jobIds = {
  importRun: (importJobId: string, runSeq: number) => `ij-${importJobId}-${runSeq}`,
  mediaDownload: (mediaId: string) => `media-${mediaId}`,
  thumbnail: (mediaId: string) => `thumb-${mediaId}`,
  metadata: (mediaId: string) => `meta-${mediaId}`,
} as const;

/** BullMQ job name of an import run (queue QUEUES.telegramImport). */
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
