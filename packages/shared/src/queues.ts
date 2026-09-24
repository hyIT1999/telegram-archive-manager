/** BullMQ queue names. BullMQ is transport only — PostgreSQL holds the authoritative state. */
export const QUEUES = {
  telegramControl: 'telegram-control',
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
