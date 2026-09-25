import { setTimeout as sleep } from 'node:timers/promises';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Channel, ImportJob } from '@tam/database';
import { PrismaService } from '@tam/database/nest';
import { ChatType, type ImportJobData, ImportJobType, ImportMode, JobStatus } from '@tam/shared';
import { channelFolderName } from '@tam/storage';
import {
  AuthRequiredError,
  ChatProtectedError,
  ChatUnavailableError,
  FloodWaitError,
  MAX_HISTORY_PAGE,
  type Message,
} from '@tam/telegram';
import { errorMessage } from '../common/error-message.js';
import { TelegramAuthService } from '../telegram/telegram-auth.service.js';
import {
  TELEGRAM_API_PROVIDER,
  type TelegramApi,
  type TelegramApiProvider,
} from '../telegram/telegram.tokens.js';
import { type ArchiveRange, ArchiveWriter, type ChannelPosition } from './archive-writer.js';
import { ArchiveRangeMovedError, ImportInterruptedError } from './import-errors.js';
import { IMPORT_SETTINGS, type ImportSettings } from './import-settings.js';

/** How a run ended: the job is done, it was paused/cancelled meanwhile, or the run was outdated. */
export type RunOutcome = 'completed' | 'interrupted' | 'stale';

/** The job statuses a run may (still) work on. */
const RUNNABLE: JobStatus[] = [JobStatus.PENDING, JobStatus.RUNNING];

/** Everything one run works with. */
interface Run {
  readonly job: ImportJob;
  readonly signal: AbortSignal | undefined;
  /** FROM_DATE: the oldest date kept; null keeps everything. */
  readonly keepFrom: Date | null;
}

/** A chat whose history is imported into a channel row: the channel itself or its old group. */
interface Target {
  channel: Channel;
  chatId: string;
}

/**
 * Runs one import job against the channel's archived range [backfillCursorId … headMessageId]:
 *
 * 1. forward — messages newer than the range, oldest first, moving the head up page by page;
 * 2. backfill — history older than the range, newest first, moving the cursor down, until the
 *    start of the chat (ALL) or the chosen date (FROM_DATE);
 * 3. the basic group a supergroup was upgraded from, into its own channel row (frozen: backfill
 *    only).
 *
 * Every page is committed with the range it continues (ArchiveWriter), so a run that stops
 * anywhere — crash, shutdown, pause, Telegram error — resumes exactly where the archive stands,
 * never storing a message twice. PostgreSQL decides who works on a job: a run only writes while
 * the job is RUNNING with the run's sequence number (compare-and-set).
 */
@Injectable()
export class ImportRunner {
  private readonly logger = new Logger(ImportRunner.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(TELEGRAM_API_PROVIDER) private readonly telegram: TelegramApiProvider,
    private readonly auth: TelegramAuthService,
    private readonly writer: ArchiveWriter,
    @Inject(IMPORT_SETTINGS) private readonly settings: ImportSettings,
  ) {}

  /** Throws Telegram errors (waits, lost session, protection…) for the processor to handle. */
  async run(data: ImportJobData, signal?: AbortSignal): Promise<RunOutcome> {
    const current = await this.prisma.importJob.findUnique({ where: { id: data.importJobId } });
    if (!current || current.runSeq !== data.runSeq || !RUNNABLE.includes(current.status)) {
      return 'stale';
    }
    // Checked before claiming, so a job waiting for Telegram stays PENDING.
    await this.auth.requireReady();
    this.assertConnected();
    const job = await this.claim(data);
    if (!job) {
      return 'stale';
    }

    const run: Run = {
      job,
      signal,
      keepFrom: job.mode === ImportMode.FROM_DATE ? job.fromDate : null,
    };
    try {
      const channel = await this.refreshChannel(job.channelId);
      if (job.totalMessages === null) {
        await this.estimateTotal(run, channel);
      }
      const target: Target = { channel, chatId: channel.telegramChatId.toString() };
      if (channel.headMessageId !== null) {
        await this.forward(run, target);
      }
      if (job.type === ImportJobType.IMPORT) {
        await this.backfill(run, target);
        if (target.channel.migratedFromChatId !== null) {
          await this.importOldGroup(run, target.channel);
        }
      }
      await this.complete(run);
      return 'completed';
    } catch (error) {
      if (error instanceof ImportInterruptedError) {
        return 'interrupted';
      }
      throw error;
    }
  }

  /** Shows why an unfinished job is not moving (rate limit, no Telegram connection…). */
  async noteWaiting(data: ImportJobData, detail: string): Promise<void> {
    await this.prisma.importJob.updateMany({
      where: { id: data.importJobId, runSeq: data.runSeq, status: { in: RUNNABLE } },
      data: { statusDetail: detail },
    });
  }

  /** Ends the job as FAILED unless it was paused, cancelled or finished meanwhile. */
  async fail(data: ImportJobData, message: string): Promise<boolean> {
    const { count } = await this.prisma.importJob.updateMany({
      where: { id: data.importJobId, runSeq: data.runSeq, status: { in: RUNNABLE } },
      data: {
        status: JobStatus.FAILED,
        error: message,
        statusDetail: null,
        completedAt: new Date(),
      },
    });
    return count > 0;
  }

  /** The live connection, read on every use: a reconnect replaces it. */
  private get api(): TelegramApi {
    return this.telegram.api;
  }

  /** Throws TelegramUnavailableError while the worker holds no Telegram connection. */
  private assertConnected(): void {
    void this.telegram.api;
  }

  /** PENDING → RUNNING; a job already RUNNING with this run's number resumes (crash, stall). */
  private async claim(data: ImportJobData): Promise<ImportJob | null> {
    const claimed = await this.prisma.$executeRaw`
      UPDATE import_jobs
      SET status = 'RUNNING', started_at = coalesce(started_at, now()), status_detail = NULL,
          error = NULL, updated_at = now()
      WHERE id = ${data.importJobId}::uuid AND run_seq = ${data.runSeq}
        AND status IN ('PENDING', 'RUNNING')`;
    if (claimed === 0) {
      return null;
    }
    return this.prisma.importJob.findUnique({ where: { id: data.importJobId } });
  }

  /**
   * Reads the chat from Telegram first, so the archive keeps its title and flags current and
   * never reads a chat that turned protected (it stops syncing, and the job fails).
   */
  private async refreshChannel(channelId: string): Promise<Channel> {
    const stored = await this.prisma.channel.findUniqueOrThrow({ where: { id: channelId } });
    const chat = await this.api.refreshChat(stored.telegramChatId.toString());
    const details = {
      title: chat.title,
      username: chat.username,
      accessHash: chat.accessHash === null ? null : BigInt(chat.accessHash),
      isForum: chat.isForum,
      isProtected: chat.isProtected,
      memberCount: chat.memberCount,
    };
    const channel = await this.prisma.channel.update({
      where: { id: channelId },
      data: {
        ...details,
        migratedFromChatId:
          chat.migratedFromChatId === null ? null : BigInt(chat.migratedFromChatId),
        ...(chat.isProtected ? { syncEnabled: false } : {}),
      },
    });
    await this.prisma.telegramDialog.updateMany({
      where: { telegramChatId: channel.telegramChatId },
      data: details,
    });
    if (chat.isProtected) {
      throw new ChatProtectedError(chat.id);
    }
    return channel;
  }

  /**
   * Expected number of messages this job reads, from Telegram's count minus what the archive
   * already holds. FROM_DATE: message ids of channels and supergroups count up one by one, so the
   * id distance from the newest message to the last one before the date is close (deleted
   * messages make it a little high). Basic groups share ids with the account's other chats, so
   * they get no estimate. The exact number replaces it when the job completes.
   */
  private async estimateTotal(run: Run, channel: Channel): Promise<void> {
    const chatId = channel.telegramChatId.toString();
    const newest = await this.api.getHistoryPage(chatId, { limit: 1 });
    let estimate: number | null;
    if (run.keepFrom === null) {
      const stored = await this.prisma.message.count({ where: { channelId: channel.id } });
      estimate = Math.max(newest.total - stored, 0) + (await this.oldGroupEstimate(channel));
    } else if (channel.type === ChatType.GROUP) {
      estimate = null;
    } else {
      const newestId = Number(newest.messages[0]?.id ?? 0);
      const before = await this.api.getHistoryPage(chatId, { beforeDate: run.keepFrom, limit: 1 });
      const floor = Number(before.messages[0]?.id ?? 0);
      const stored = await this.prisma.message.count({
        where: { channelId: channel.id, telegramMessageId: { gt: floor } },
      });
      estimate = Math.max(newestId - floor - stored, 0);
    }
    await this.prisma.importJob.updateMany({
      where: { id: run.job.id, runSeq: run.job.runSeq, status: JobStatus.RUNNING },
      data: { totalMessages: estimate },
    });
  }

  private async oldGroupEstimate(channel: Channel): Promise<number> {
    if (channel.migratedFromChatId === null) {
      return 0;
    }
    try {
      const page = await this.api.getHistoryPage(channel.migratedFromChatId.toString(), {
        limit: 1,
      });
      const stored = await this.prisma.message.count({
        where: { channel: { telegramChatId: channel.migratedFromChatId } },
      });
      return Math.max(page.total - stored, 0);
    } catch (error) {
      if (error instanceof FloodWaitError || error instanceof AuthRequiredError) {
        throw error;
      }
      return 0; // an old group this account cannot read is skipped later on
    }
  }

  /** Messages newer than the head, oldest first, until Telegram has no newer ones. */
  private async forward(run: Run, target: Target): Promise<void> {
    for (;;) {
      await this.checkpoint(run);
      const range = rangeOf(target.channel);
      const head = range.headMessageId;
      if (head === null) {
        return;
      }
      const page = await this.api.getNewerMessages(target.chatId, String(head), MAX_HISTORY_PAGE);
      if (page.length === 0) {
        return;
      }
      const newestId = Math.max(...page.map(messageId));
      if (await this.write(run, target, page, range, { headMessageId: newestId })) {
        await this.pause(run);
      }
    }
  }

  /**
   * History older than the cursor, newest first. The first page of a never-imported chat also
   * sets the head (its newest message). FROM_DATE stops at the first message sent before the
   * date and leaves the history marked incomplete, so a later import can go further back.
   */
  private async backfill(run: Run, target: Target): Promise<void> {
    for (;;) {
      const channel = target.channel;
      if (channel.backfillComplete && channel.headMessageId !== null) {
        return;
      }
      await this.checkpoint(run);
      const range = rangeOf(channel);
      const page = await this.api.getHistoryPage(target.chatId, {
        ...(range.backfillCursorId === null
          ? {}
          : { beforeMessageId: String(range.backfillCursorId) }),
        limit: MAX_HISTORY_PAGE,
      });
      const messages = page.messages;
      const newest = messages[0];
      if (!newest) {
        // The start of the chat: everything below the cursor is archived (or the chat is empty).
        if (await this.write(run, target, [], range, { backfillComplete: true })) {
          return;
        }
        continue;
      }

      const keepFrom = run.keepFrom;
      const kept =
        keepFrom === null ? messages : messages.filter((message) => message.date >= keepFrom);
      const reachedDate = kept.length < messages.length;
      const next: Partial<ChannelPosition> = {};
      if (range.headMessageId === null) {
        // A chat never imported (or empty until now): its range starts at the newest message.
        next.headMessageId = messageId(newest);
        next.backfillComplete = false;
      }
      const oldestKept = kept.at(-1);
      if (oldestKept) {
        next.backfillCursorId = messageId(oldestKept);
      } else if (range.backfillCursorId === null) {
        // Nothing on or after the date: an empty range just above the newest message.
        next.backfillCursorId = messageId(newest) + 1;
      }
      if (!(await this.write(run, target, kept, range, next))) {
        continue;
      }
      if (reachedDate) {
        return;
      }
      await this.pause(run);
    }
  }

  /**
   * A supergroup upgraded from a basic group keeps the older messages in the old group, with
   * their own ids; they go into a channel row of their own that points at the supergroup. Old
   * groups this account never belonged to, or with content protection, are skipped.
   */
  private async importOldGroup(run: Run, channel: Channel): Promise<void> {
    const chatId = channel.migratedFromChatId;
    if (chatId === null) {
      return;
    }
    let oldGroup = await this.prisma.channel.findUnique({ where: { telegramChatId: chatId } });
    if (oldGroup?.isProtected || (oldGroup?.backfillComplete && oldGroup.headMessageId !== null)) {
      return;
    }
    if (!oldGroup) {
      const group = await this.api.getLegacyGroup(chatId.toString());
      if (!group) {
        this.logger.log(
          `Skipping the old group of "${channel.title}": this account cannot read it`,
        );
        return;
      }
      oldGroup = await this.prisma.channel.upsert({
        where: { telegramChatId: chatId },
        create: {
          telegramChatId: chatId,
          title: group.title,
          type: ChatType.GROUP,
          isProtected: group.isProtected,
          migratedToChannelId: channel.id,
          storageLocationId: channel.storageLocationId,
          storageFolder: channelFolderName(group.title, group.id),
        },
        update: { migratedToChannelId: channel.id },
      });
      if (oldGroup.isProtected) {
        return;
      }
    }
    try {
      await this.backfill(run, { channel: oldGroup, chatId: chatId.toString() });
    } catch (error) {
      if (!(error instanceof ChatUnavailableError)) {
        throw error;
      }
      this.logger.log(`Skipping the old group of "${channel.title}": ${errorMessage(error)}`);
    }
  }

  /**
   * Stores a page. False when the channel's range moved meanwhile: the target is re-read and the
   * caller fetches the page again from the new position.
   */
  private async write(
    run: Run,
    target: Target,
    messages: readonly Message[],
    expected: ArchiveRange,
    next: Partial<ChannelPosition>,
  ): Promise<boolean> {
    try {
      await this.writer.writePage({
        job: { id: run.job.id, runSeq: run.job.runSeq },
        channelId: target.channel.id,
        messages,
        expected,
        next,
      });
      target.channel = { ...target.channel, ...next };
      return true;
    } catch (error) {
      if (!(error instanceof ArchiveRangeMovedError)) {
        throw error;
      }
      target.channel = await this.prisma.channel.findUniqueOrThrow({
        where: { id: target.channel.id },
      });
      return false;
    }
  }

  /** Stops at a page boundary when the worker shuts down or the job left RUNNING. */
  private async checkpoint(run: Run): Promise<void> {
    run.signal?.throwIfAborted();
    const running = await this.prisma.importJob.count({
      where: { id: run.job.id, runSeq: run.job.runSeq, status: JobStatus.RUNNING },
    });
    if (running === 0) {
      throw new ImportInterruptedError();
    }
  }

  /** Spaces pages out; an abort (shutdown) ends the wait at once. */
  private async pause(run: Run): Promise<void> {
    if (this.settings.pageDelayMs > 0) {
      await sleep(this.settings.pageDelayMs, undefined, { signal: run.signal });
    }
  }

  /**
   * History phase done, and the total becomes exact. Media files are recorded with a download job
   * each; they download on their own schedule (MediaModule), so the job completes here and the
   * channel can be imported or synced again while files are still downloading.
   */
  private async complete(run: Run): Promise<void> {
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      const done = await tx.$executeRaw`
        UPDATE import_jobs
        SET status = 'COMPLETED', phase = 'DONE', total_messages = processed_messages,
            status_detail = NULL, error = NULL, messages_completed_at = ${now}, completed_at = ${now}, updated_at = ${now}
        WHERE id = ${run.job.id}::uuid AND run_seq = ${run.job.runSeq} AND status = 'RUNNING'`;
      if (done === 0) {
        throw new ImportInterruptedError();
      }
      await tx.channel.update({ where: { id: run.job.channelId }, data: { lastSyncedAt: now } });
    });
  }
}

function rangeOf(channel: Channel): ArchiveRange {
  return { headMessageId: channel.headMessageId, backfillCursorId: channel.backfillCursorId };
}

function messageId(message: Message): number {
  return Number(message.id);
}
