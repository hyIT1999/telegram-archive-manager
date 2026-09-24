import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@tam/database';
import { PrismaService } from '@tam/database/nest';
import {
  ACTIVE_JOB_STATUSES,
  ApiErrorCode,
  ImportErrorCode,
  type ImportJobDto,
  type ImportJobListQuery,
  ImportJobType,
  ImportMode,
  type ImportRequest,
  JobStatus,
  type Page,
  TELEGRAM_ACCOUNT_KEY,
  TelegramAuthState,
  TelegramErrorCode,
  jobIds,
} from '@tam/shared';
import { z } from 'zod';
import { decodeCursor, encodeCursor } from '../common/pagination/cursor.js';
import {
  IMPORT_JOB_INCLUDE,
  type ImportJobWithChannel,
  toImportJobDto,
} from './import-job.mapper.js';
import { ImportQueue } from './import-queue.js';

/** Keyset position in the (createdAt desc, id desc) order. */
const jobCursorSchema = z
  .tuple([z.iso.datetime(), z.uuid()])
  .transform(([createdAt, id]) => ({ createdAt: new Date(createdAt), id }));
type JobCursor = z.output<typeof jobCursorSchema>;

export interface StartedImport {
  job: ImportJobDto;
  /** False when the same import was already queued or running (the request is idempotent). */
  created: boolean;
}

/**
 * Import jobs. PostgreSQL holds their state and every change is a compare-and-set on the status
 * (and run number), so two clicks, two tabs or a click racing the worker can never both win. The
 * worker reads the status before every page it stores; BullMQ only carries the runs.
 */
@Injectable()
export class ImportJobsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: ImportQueue,
  ) {}

  /**
   * Starts importing a channel's history (all of it, or since a date). Repeating the request
   * while that import is unfinished returns it; a different import of the channel is a conflict.
   */
  async start(channelId: string, request: ImportRequest): Promise<StartedImport> {
    const channel = await this.prisma.channel.findUnique({ where: { id: channelId } });
    if (!channel) {
      throw new NotFoundException({ message: 'Channel not found', code: ApiErrorCode.NOT_FOUND });
    }
    if (channel.isProtected) {
      throw new UnprocessableEntityException({
        code: TelegramErrorCode.CHAT_PROTECTED,
        message: 'This chat has content protection enabled, so it cannot be archived.',
      });
    }
    if (channel.migratedToChannelId !== null) {
      throw new UnprocessableEntityException({
        code: ImportErrorCode.CHANNEL_MIGRATED,
        message:
          'This group was upgraded to a supergroup. Import the supergroup: its import includes this history.',
      });
    }
    await this.requireTelegramReady();

    const fromDate = request.mode === ImportMode.FROM_DATE ? new Date(request.fromDate) : null;
    const active = await this.activeJob(channelId);
    if (active) {
      return this.sameImportOrConflict(active, request.mode, fromDate);
    }
    let job: ImportJobWithChannel;
    try {
      job = await this.prisma.$transaction(async (tx) => {
        const created = await tx.importJob.create({
          data: { channelId, type: ImportJobType.IMPORT, mode: request.mode, fromDate, runSeq: 1 },
        });
        return tx.importJob.update({
          where: { id: created.id },
          data: { bullJobId: jobIds.importRun(created.id, 1) },
          include: IMPORT_JOB_INCLUDE,
        });
      });
    } catch (error) {
      // Another request created the channel's unfinished job first (one per channel).
      const raced = isUniqueViolation(error) ? await this.activeJob(channelId) : null;
      if (raced) {
        return this.sameImportOrConflict(raced, request.mode, fromDate);
      }
      throw error;
    }
    await this.queue.enqueue(job.id, job.runSeq);
    return { job: toImportJobDto(job), created: true };
  }

  async list(query: ImportJobListQuery): Promise<Page<ImportJobDto>> {
    const cursor =
      query.cursor === undefined ? undefined : decodeCursor(query.cursor, jobCursorSchema);
    const rows = await this.prisma.importJob.findMany({
      where: {
        AND: [
          query.channelId === undefined ? {} : { channelId: query.channelId },
          query.status === undefined ? {} : { status: { in: query.status } },
          afterCursor(cursor),
        ],
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      include: IMPORT_JOB_INCLUDE,
    });
    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    const last = page.at(-1);
    return {
      items: page.map(toImportJobDto),
      nextCursor: hasMore && last ? encodeCursor([last.createdAt.toISOString(), last.id]) : null,
    };
  }

  async get(id: string): Promise<ImportJobDto> {
    return toImportJobDto(await this.find(id));
  }

  /** A queued or running job stops at its next page; nothing it stored is lost. */
  async pause(id: string): Promise<ImportJobDto> {
    const { count } = await this.prisma.importJob.updateMany({
      where: { id, status: { in: [JobStatus.PENDING, JobStatus.RUNNING] } },
      data: { status: JobStatus.PAUSED, statusDetail: null },
    });
    const job = await this.find(id);
    if (count === 0) {
      throw invalidState(job, 'Only a queued or running import can be paused.');
    }
    await this.queue.discard(job.id, job.runSeq);
    return toImportJobDto(job);
  }

  /** Queues a new run of a paused job; it continues where the archive stands. */
  async resume(id: string): Promise<ImportJobDto> {
    const current = await this.find(id);
    const runSeq = current.runSeq + 1;
    const { count } = await this.prisma.importJob.updateMany({
      where: { id, status: JobStatus.PAUSED, runSeq: current.runSeq },
      data: {
        status: JobStatus.PENDING,
        runSeq,
        bullJobId: jobIds.importRun(id, runSeq),
        statusDetail: null,
        error: null,
      },
    });
    if (count === 0) {
      throw invalidState(await this.find(id), 'Only a paused import can be resumed.');
    }
    await this.queue.enqueue(id, runSeq);
    return toImportJobDto(await this.find(id));
  }

  /**
   * Ends the job for good. Messages stored so far stay in the archive; downloads of the job that
   * have not started are cancelled with it.
   */
  async cancel(id: string): Promise<ImportJobDto> {
    const now = new Date();
    const cancelled = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.importJob.updateMany({
        where: { id, status: { in: [...ACTIVE_JOB_STATUSES] } },
        data: { status: JobStatus.CANCELLED, completedAt: now, statusDetail: null },
      });
      if (count === 0) {
        return false;
      }
      await tx.$executeRaw`
        UPDATE media AS m
        SET download_status = 'CANCELLED', updated_at = ${now}
        FROM download_jobs AS d
        WHERE d.media_id = m.id AND d.import_job_id = ${id}::uuid
          AND d.status IN ('PENDING', 'PAUSED') AND m.download_status = 'PENDING'`;
      await tx.$executeRaw`
        UPDATE download_jobs
        SET status = 'CANCELLED', updated_at = ${now}
        WHERE import_job_id = ${id}::uuid AND status IN ('PENDING', 'PAUSED')`;
      return true;
    });
    const job = await this.find(id);
    if (!cancelled) {
      throw invalidState(job, 'This import has already ended.');
    }
    await this.queue.discard(job.id, job.runSeq);
    return toImportJobDto(job);
  }

  private async find(id: string): Promise<ImportJobWithChannel> {
    const job = await this.prisma.importJob.findUnique({
      where: { id },
      include: IMPORT_JOB_INCLUDE,
    });
    if (!job) {
      throw new NotFoundException({
        message: 'Import job not found',
        code: ApiErrorCode.NOT_FOUND,
      });
    }
    return job;
  }

  private activeJob(channelId: string): Promise<ImportJobWithChannel | null> {
    return this.prisma.importJob.findFirst({
      where: { channelId, status: { in: [...ACTIVE_JOB_STATUSES] } },
      include: IMPORT_JOB_INCLUDE,
    });
  }

  private sameImportOrConflict(
    active: ImportJobWithChannel,
    mode: ImportMode,
    fromDate: Date | null,
  ): StartedImport {
    const same =
      active.type === ImportJobType.IMPORT &&
      active.mode === mode &&
      (active.fromDate?.getTime() ?? null) === (fromDate?.getTime() ?? null);
    if (!same) {
      throw new ConflictException({
        code: ImportErrorCode.IMPORT_ACTIVE,
        message:
          'This channel already has an unfinished import with other settings. Let it finish, or cancel it first.',
        details: { jobId: active.id },
      });
    }
    return { job: toImportJobDto(active), created: false };
  }

  /** Imports read Telegram with the account; without a login they could never run. */
  private async requireTelegramReady(): Promise<void> {
    const account = await this.prisma.telegramAccount.findUnique({
      where: { accountKey: TELEGRAM_ACCOUNT_KEY },
      select: { authState: true },
    });
    if (account?.authState !== TelegramAuthState.READY) {
      throw new ConflictException({
        code: TelegramErrorCode.TELEGRAM_NOT_READY,
        message: 'Log in to Telegram first (New import → Connect Telegram).',
      });
    }
  }
}

function invalidState(job: ImportJobWithChannel, message: string): ConflictException {
  return new ConflictException({
    code: ImportErrorCode.INVALID_JOB_STATE,
    message,
    details: { status: job.status },
  });
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

function afterCursor(cursor: JobCursor | undefined): Prisma.ImportJobWhereInput {
  if (cursor === undefined) {
    return {};
  }
  return {
    OR: [
      { createdAt: { lt: cursor.createdAt } },
      { createdAt: cursor.createdAt, id: { lt: cursor.id } },
    ],
  };
}
