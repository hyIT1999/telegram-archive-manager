import { InjectQueue } from '@nestjs/bullmq';
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { type ImportJob, type Prisma, createImportJob } from '@tam/database';
import { PrismaService } from '@tam/database/nest';
import {
  ACTIVE_JOB_STATUSES,
  ChatType,
  IMPORT_RUN_JOB_NAME,
  type ImportJobData,
  ImportJobType,
  JobOrigin,
  JobStatus,
  QUEUES,
  SYNC_SETTINGS_KEY,
  importRunJobOptions,
  jobIds,
  readSyncSettings,
} from '@tam/shared';
import {
  AuthRequiredError,
  ChatUnavailableError,
  FloodWaitError,
  LoginStepError,
} from '@tam/telegram';
import type { Queue } from 'bullmq';
import { errorMessage } from '../common/error-message.js';
import { SYNC_NOTES } from '../common/sync-notes.js';
import { telegramReady } from '../media/telegram-ready.js';
import { TelegramAuthService } from '../telegram/telegram-auth.service.js';
import { TelegramCooldown } from '../telegram/telegram-cooldown.js';
import { TelegramUpdates } from '../telegram/telegram-updates.js';
import {
  TELEGRAM_API_PROVIDER,
  type TelegramApiProvider,
  TelegramUnavailableError,
} from '../telegram/telegram.tokens.js';
import { NewMessagesListener } from './new-messages.listener.js';
import {
  SYNCED_CHANNEL,
  SYNC_SCHEDULER_SETTINGS,
  type SyncSchedulerSettings,
} from './sync-settings.js';

/** What one round did (logs, tests). */
export interface SyncRound {
  /** Syncs queued for messages Telegram announced. */
  announced: number;
  /** Channels checked with Telegram. */
  checked: number;
  /** Syncs queued because a check found new messages. */
  queued: number;
}

const DAY_MS = 24 * 3_600_000;

/** A channel as a round sees it: its archive, whether a job holds it, and its latest sync. */
const CANDIDATE = {
  id: true,
  title: true,
  type: true,
  telegramChatId: true,
  headMessageId: true,
  _count: { select: { importJobs: { where: { status: { in: [...ACTIVE_JOB_STATUSES] } } } } },
  importJobs: {
    where: { type: ImportJobType.SYNC },
    orderBy: { createdAt: 'desc' },
    take: 1,
    select: { status: true, createdAt: true },
  },
} satisfies Prisma.ChannelSelect;

type Candidate = Prisma.ChannelGetPayload<{ select: typeof CANDIDATE }>;

/**
 * Keeps synced channels up to date; the only place syncs start on their own. Every round (while
 * Telegram is ready):
 * 1. channels Telegram announced new messages for (NewMessagesListener) get a sync, at most one
 *    per channel a minute;
 * 2. channels not synced for the interval of Settings → Sync are checked with one small history
 *    request each: nothing new only records the time, anything new gets a sync;
 * 3. once a day, syncs that started on their own and ended long ago are forgotten.
 *
 * A job already holding a channel (an import reads new messages first) waits: the channel stays
 * pending and is looked at again next round. Creating a job races nobody: the database allows
 * one unfinished job per channel, and a lost race creates nothing.
 */
@Injectable()
export class SyncScheduler implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(SyncScheduler.name);
  /** Channels whose check failed unexpectedly, and when they may be checked again. */
  private readonly failedUntil = new Map<string, number>();
  private readonly shutdown = new AbortController();
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<unknown> | undefined;
  private forgottenAt = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly announced: NewMessagesListener,
    private readonly updates: TelegramUpdates,
    private readonly auth: TelegramAuthService,
    private readonly cooldown: TelegramCooldown,
    @Inject(TELEGRAM_API_PROVIDER) private readonly telegram: TelegramApiProvider,
    @InjectQueue(QUEUES.telegramSync) private readonly queue: Queue<ImportJobData>,
    @Inject(SYNC_SCHEDULER_SETTINGS) private readonly settings: SyncSchedulerSettings,
  ) {}

  onApplicationBootstrap(): void {
    const interval = this.settings.tickMs;
    if (interval === null) {
      return;
    }
    this.timer = setInterval(() => this.tick(), interval);
    this.timer.unref();
  }

  async onModuleDestroy(): Promise<void> {
    clearInterval(this.timer);
    this.shutdown.abort();
    await this.idle();
  }

  /** Resolves when no round is running (shutdown, tests). */
  async idle(): Promise<void> {
    await this.running;
  }

  /** One round (see the class comment). */
  async syncDue(now = new Date()): Promise<SyncRound> {
    const round: SyncRound = { announced: 0, checked: 0, queued: 0 };
    if (!(await telegramReady(this.telegram, this.auth, this.cooldown))) {
      return round;
    }
    // Idempotent: in case starting at connect time failed.
    await this.updates.start().catch((error: unknown) => {
      this.logger.warn(`Could not start receiving Telegram updates: ${errorMessage(error)}`);
    });
    await this.syncAnnounced(round, now);
    await this.checkDue(round, now);
    await this.forgetOldSyncs(now);
    return round;
  }

  private async syncAnnounced(round: SyncRound, now: Date): Promise<void> {
    const pending = this.announced.pending();
    if (pending.size === 0) {
      return;
    }
    const channels = await this.prisma.channel.findMany({
      where: { id: { in: [...pending.keys()] }, ...SYNCED_CHANNEL },
      select: CANDIDATE,
    });
    const byId = new Map(channels.map((channel) => [channel.id, channel]));
    for (const [channelId, newestId] of pending) {
      if (this.shutdown.signal.aborted) {
        return;
      }
      const channel = byId.get(channelId);
      const head = channel?.headMessageId ?? null;
      if (!channel || head === null || head >= newestId) {
        // Switched off, never imported (its import reads everything), or archived meanwhile.
        this.announced.settle(channelId, newestId);
        continue;
      }
      if (this.busy(channel, now.getTime() - this.settings.updateGapMs, now)) {
        continue;
      }
      if (await this.queueSync(channel, JobOrigin.TELEGRAM_UPDATE, newestId - head)) {
        this.announced.settle(channelId, newestId);
        round.announced += 1;
      }
    }
  }

  private async checkDue(round: SyncRound, now: Date): Promise<void> {
    const cutoff = new Date(now.getTime() - (await this.intervalMinutes()) * 60_000);
    const due = await this.prisma.channel.findMany({
      where: {
        ...SYNCED_CHANNEL,
        headMessageId: { not: null },
        OR: [{ lastSyncedAt: null }, { lastSyncedAt: { lt: cutoff } }],
      },
      select: CANDIDATE,
      orderBy: [{ lastSyncedAt: { sort: 'asc', nulls: 'first' } }, { id: 'asc' }],
    });
    for (const channel of due) {
      if (round.checked >= this.settings.checkBatch || this.shutdown.signal.aborted) {
        return;
      }
      const head = channel.headMessageId;
      if (
        head === null ||
        this.busy(channel, cutoff.getTime(), now) ||
        (this.failedUntil.get(channel.id) ?? 0) > now.getTime()
      ) {
        continue;
      }
      try {
        const page = await this.telegram.api.getHistoryPage(channel.telegramChatId.toString(), {
          limit: 1,
        });
        round.checked += 1;
        this.failedUntil.delete(channel.id);
        const newest = Number(page.messages[0]?.id ?? 0);
        if (newest <= head) {
          await this.prisma.channel.updateMany({
            where: { id: channel.id },
            data: { lastSyncedAt: new Date() },
          });
        } else if (await this.queueSync(channel, JobOrigin.SCHEDULE, newest - head)) {
          round.queued += 1;
        }
      } catch (error) {
        if (error instanceof FloodWaitError) {
          this.cooldown.note(error.seconds);
          return;
        }
        if (
          error instanceof AuthRequiredError ||
          error instanceof TelegramUnavailableError ||
          error instanceof LoginStepError
        ) {
          // Not ready after all: the next round tries again.
          return;
        }
        if (error instanceof ChatUnavailableError) {
          await this.stopSyncing(channel, error.message);
          continue;
        }
        this.failedUntil.set(channel.id, Date.now() + this.settings.checkBackoffMs);
        this.logger.warn(
          `Could not check "${channel.title}" for new messages: ${errorMessage(error)}`,
        );
      }
    }
  }

  /**
   * A job holds the channel, a sync started after `since`, or its latest sync failed not long
   * ago (a sync failing every time would otherwise run all day).
   */
  private busy(channel: Candidate, since: number, now: Date): boolean {
    if (channel._count.importJobs > 0) {
      return true;
    }
    const last = channel.importJobs[0];
    if (!last) {
      return false;
    }
    const started = last.createdAt.getTime();
    return (
      started >= since ||
      (last.status === JobStatus.FAILED &&
        started >= now.getTime() - this.settings.failedSyncBackoffMs)
    );
  }

  /** Creates and queues a sync; null when another job holds the channel meanwhile. */
  private async queueSync(
    channel: Candidate,
    origin: JobOrigin,
    newMessages: number,
  ): Promise<ImportJob | null> {
    const job = await createImportJob(
      this.prisma,
      {
        channelId: channel.id,
        type: ImportJobType.SYNC,
        origin,
        // Basic groups share message ids with the account's other chats: no estimate from ids.
        totalMessages: channel.type === ChatType.GROUP ? null : newMessages,
      },
      jobIds.importRun,
    );
    if (!job) {
      return null;
    }
    try {
      await this.queue.add(
        IMPORT_RUN_JOB_NAME,
        { importJobId: job.id, runSeq: job.runSeq },
        importRunJobOptions(job.id, job.runSeq),
      );
    } catch (error) {
      // The job is saved: the import reconciler queues it within a minute.
      this.logger.warn(`Sync of "${channel.title}" saved but not queued: ${errorMessage(error)}`);
    }
    this.logger.log(
      origin === JobOrigin.TELEGRAM_UPDATE
        ? `Syncing "${channel.title}": Telegram announced new messages`
        : `Syncing "${channel.title}": new messages since the last check`,
    );
    return job;
  }

  /** The account can no longer read the chat: sync switches off, and the channel page says why. */
  private async stopSyncing(channel: Candidate, reason: string): Promise<void> {
    await this.prisma.channel.updateMany({
      where: { id: channel.id, syncEnabled: true },
      data: { syncEnabled: false, syncNote: SYNC_NOTES.unreadable },
    });
    this.logger.warn(`Stopped syncing "${channel.title}": ${reason}`);
  }

  private async intervalMinutes(): Promise<number> {
    const row = await this.prisma.appSetting.findUnique({ where: { key: SYNC_SETTINGS_KEY } });
    return readSyncSettings(row?.value).intervalMinutes;
  }

  /** Syncs that started on their own and ended long ago only fill the list of jobs. */
  private async forgetOldSyncs(now: Date): Promise<void> {
    if (now.getTime() - this.forgottenAt < DAY_MS) {
      return;
    }
    this.forgottenAt = now.getTime();
    const { count } = await this.prisma.importJob.deleteMany({
      where: {
        type: ImportJobType.SYNC,
        origin: { not: JobOrigin.MANUAL },
        status: { in: [JobStatus.COMPLETED, JobStatus.CANCELLED, JobStatus.FAILED] },
        completedAt: { lt: new Date(now.getTime() - this.settings.keepSyncJobsMs) },
      },
    });
    if (count > 0) {
      this.logger.log(`Forgot ${count} old automatic sync(s)`);
    }
  }

  private tick(): void {
    if (this.running || this.shutdown.signal.aborted) {
      return;
    }
    this.running = this.syncDue()
      .catch((error: unknown) => {
        this.logger.warn(`A sync round failed: ${errorMessage(error)}`);
      })
      .finally(() => {
        this.running = undefined;
      });
  }
}
