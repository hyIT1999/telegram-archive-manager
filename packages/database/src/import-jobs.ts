import {
  type ImportJob,
  type ImportJobType,
  type ImportMode,
  type JobOrigin,
  Prisma,
  type PrismaClient,
} from './generated/prisma/client.js';

export interface NewImportJob {
  channelId: string;
  type: ImportJobType;
  origin?: JobOrigin;
  mode?: ImportMode;
  fromDate?: Date | null;
  /** Messages the job is expected to read, when its creator knows (a sync: newest id − head). */
  totalMessages?: number | null;
}

/** The BullMQ job id of a run (see jobIds.importRun in @tam/shared). */
export type RunJobId = (importJobId: string, runSeq: number) => string;

/**
 * Adds a job at run 1, with the BullMQ id of that run, inside `tx`. Throws a unique violation
 * (P2002) when the channel already has an unfinished job: a partial unique index allows one
 * PENDING, RUNNING or PAUSED job per channel, so creators racing each other (the api, the sync
 * scheduler) can never both win.
 */
export async function insertImportJob(
  tx: Prisma.TransactionClient,
  job: NewImportJob,
  runJobId: RunJobId,
): Promise<ImportJob> {
  const created = await tx.importJob.create({
    data: {
      channelId: job.channelId,
      type: job.type,
      ...(job.origin === undefined ? {} : { origin: job.origin }),
      ...(job.mode === undefined ? {} : { mode: job.mode }),
      fromDate: job.fromDate ?? null,
      totalMessages: job.totalMessages ?? null,
      runSeq: 1,
    },
  });
  return tx.importJob.update({
    where: { id: created.id },
    data: { bullJobId: runJobId(created.id, 1) },
  });
}

/** insertImportJob in a transaction of its own; null when the channel already has an unfinished job. */
export async function createImportJob(
  prisma: PrismaClient,
  job: NewImportJob,
  runJobId: RunJobId,
): Promise<ImportJob | null> {
  try {
    return await prisma.$transaction((tx) => insertImportJob(tx, job, runJobId));
  } catch (error) {
    if (isUniqueViolation(error)) {
      return null;
    }
    throw error;
  }
}

export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}
