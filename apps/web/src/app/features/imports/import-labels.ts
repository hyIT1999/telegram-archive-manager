import type {
  ImportJobDto,
  ImportMode,
  ImportRequest,
  JobOrigin,
  JobStatus,
} from '../../shared/models';

/** How each job status reads in lists and on the job page. */
export const JOB_STATUS_LABELS: Readonly<Record<JobStatus, string>> = {
  PENDING: 'Queued',
  RUNNING: 'Importing',
  PAUSED: 'Paused',
  COMPLETED: 'Completed',
  FAILED: 'Failed',
  CANCELLED: 'Cancelled',
};

export const JOB_STATUS_ICONS: Readonly<Record<JobStatus, string>> = {
  PENDING: 'schedule',
  RUNNING: 'sync',
  PAUSED: 'pause_circle',
  COMPLETED: 'check_circle',
  FAILED: 'error',
  CANCELLED: 'cancel',
};

/** Why a job runs, as lists and the job page say it. */
export const JOB_ORIGIN_LABELS: Readonly<Record<JobOrigin, string>> = {
  MANUAL: 'Asked for',
  SCHEDULE: 'Scheduled check',
  TELEGRAM_UPDATE: 'New messages on Telegram',
};

export function isSync(job: Pick<ImportJobDto, 'type'>): boolean {
  return job.type === 'SYNC';
}

/** "import" or "sync", for sentences. */
export function jobNoun(job: Pick<ImportJobDto, 'type'>): string {
  return isSync(job) ? 'sync' : 'import';
}

/** The status as a job of its type says it: a running sync is "Syncing". */
export function statusLabel(job: Pick<ImportJobDto, 'type' | 'status'>): string {
  return job.status === 'RUNNING' && isSync(job) ? 'Syncing' : JOB_STATUS_LABELS[job.status];
}

/** Jobs that still hold the channel's import slot (one per channel). */
export const UNFINISHED_STATUSES: readonly JobStatus[] = ['PENDING', 'RUNNING', 'PAUSED'];

export function isUnfinished(job: Pick<ImportJobDto, 'status'>): boolean {
  return UNFINISHED_STATUSES.includes(job.status);
}

/** Queued or running: its numbers change, so pages showing it follow it. */
export function isMoving(job: Pick<ImportJobDto, 'status'>): boolean {
  return job.status === 'PENDING' || job.status === 'RUNNING';
}

/** Imports pause; a sync is short and would hold the channel's slot, so it can only be cancelled. */
export function canPause(job: Pick<ImportJobDto, 'status' | 'type'>): boolean {
  return isMoving(job) && !isSync(job);
}

export function canResume(job: Pick<ImportJobDto, 'status'>): boolean {
  return job.status === 'PAUSED';
}

/**
 * Share of the expected messages read so far (0–100), or null while the total is unknown.
 * Totals are estimates until the job completes, so an unfinished job never shows 100 %.
 */
export function progressPercent(job: ImportJobDto): number | null {
  if (job.status === 'COMPLETED') {
    return 100;
  }
  if (job.totalMessages === null || job.totalMessages === 0) {
    return null;
  }
  return Math.min(99, Math.floor((job.processedMessages / job.totalMessages) * 100));
}

/** Share of the job's wanted files (skipped ones aside) that are in the archive, or null. */
export function downloadedPercent(job: ImportJobDto): number | null {
  const wanted = job.totalMedia - job.skippedFiles;
  if (wanted <= 0) {
    return null;
  }
  return Math.floor((job.downloadedFiles / wanted) * 100);
}

/** A picked calendar day (YYYY-MM-DD) as the moment the day starts where the browser is. */
export function localDayStart(day: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    return null;
  }
  const start = new Date(`${day}T00:00:00`);
  return Number.isNaN(start.getTime()) ? null : start;
}

/** Today in the browser's time zone, as YYYY-MM-DD (the latest day a FROM_DATE import takes). */
export function todayInputValue(now = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

export interface ImportChoice {
  readonly mode: ImportMode;
  /** YYYY-MM-DD, used when mode is FROM_DATE. */
  readonly fromDay: string;
}

/** Why the choice cannot be sent yet, or null when it is complete. */
export function importChoiceProblem(choice: ImportChoice, now = new Date()): string | null {
  if (choice.mode === 'ALL') {
    return null;
  }
  const start = localDayStart(choice.fromDay);
  if (!start) {
    return 'Pick the first day to import.';
  }
  return choice.fromDay > todayInputValue(now) ? 'Pick a day that is not in the future.' : null;
}

/** The request for a complete choice; the date travels as an instant with the local offset. */
export function toImportRequest(choice: ImportChoice): ImportRequest | null {
  if (choice.mode === 'ALL') {
    return { mode: 'ALL' };
  }
  const start = localDayStart(choice.fromDay);
  return start ? { mode: 'FROM_DATE', fromDate: start.toISOString() } : null;
}
