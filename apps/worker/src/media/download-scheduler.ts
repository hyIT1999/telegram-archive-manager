import { InjectQueue } from '@nestjs/bullmq';
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import {
  DOWNLOAD_JOB_NAME,
  type MediaDownloadJobData,
  QUEUES,
  downloadJobOptions,
} from '@tam/shared';
import type { Queue } from 'bullmq';
import { errorMessage } from '../common/error-message.js';
import { TelegramAuthService } from '../telegram/telegram-auth.service.js';
import { TelegramCooldown } from '../telegram/telegram-cooldown.js';
import { TELEGRAM_API_PROVIDER, type TelegramApiProvider } from '../telegram/telegram.tokens.js';
import { DownloadPolicy } from './download-policy.js';
import { DownloadStore } from './download-store.js';
import { MEDIA_SETTINGS, type MediaSettings } from './media-settings.js';
import { telegramReady } from './telegram-ready.js';

/**
 * Hands waiting downloads to the media-download queue, a few at a time: as many as the download
 * settings allow at once (files asked for first, then the smallest). The queue never holds more,
 * so Redis stays small however large the archive grows. Runs every few seconds and whenever a try
 * ends; nothing starts while downloads are paused, Telegram is not ready or asked to wait.
 */
@Injectable()
export class DownloadScheduler implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(DownloadScheduler.name);
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<unknown> | undefined;
  private again = false;
  private stopped = false;

  constructor(
    private readonly store: DownloadStore,
    private readonly policy: DownloadPolicy,
    private readonly auth: TelegramAuthService,
    private readonly cooldown: TelegramCooldown,
    @Inject(TELEGRAM_API_PROVIDER) private readonly telegram: TelegramApiProvider,
    @InjectQueue(QUEUES.mediaDownload) private readonly queue: Queue<MediaDownloadJobData>,
    @Inject(MEDIA_SETTINGS) private readonly settings: MediaSettings,
  ) {}

  onApplicationBootstrap(): void {
    this.tick();
    this.timer = setInterval(() => this.tick(), this.settings.schedulerIntervalMs);
    this.timer.unref();
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    clearInterval(this.timer);
    await this.idle();
  }

  /** Resolves when no scheduling pass is running (shutdown, tests). */
  async idle(): Promise<void> {
    while (this.running) {
      await this.running;
    }
  }

  /** A try ended or something changed: look for work now rather than at the next tick. */
  nudge(): void {
    this.tick();
  }

  /** One pass; returns how many tries it queued. */
  async schedule(): Promise<number> {
    const downloads = await this.policy.current();
    if (downloads.paused || !(await telegramReady(this.telegram, this.auth, this.cooldown))) {
      return 0;
    }
    const claimed = await this.store.claim(downloads.concurrency);
    if (claimed.length === 0) {
      return 0;
    }
    try {
      await this.queue.addBulk(
        claimed.map((job) => ({
          name: DOWNLOAD_JOB_NAME,
          data: { downloadJobId: job.id, runSeq: job.runSeq },
          opts: downloadJobOptions(job.id, job.runSeq),
        })),
      );
    } catch (error) {
      await Promise.all(claimed.map((job) => this.store.unclaim(job)));
      throw error;
    }
    return claimed.length;
  }

  private tick(): void {
    if (this.stopped) {
      return;
    }
    if (this.running) {
      this.again = true;
      return;
    }
    this.running = this.schedule()
      .catch((error: unknown) =>
        this.logger.warn(`Scheduling downloads failed: ${errorMessage(error)}`),
      )
      .finally(() => {
        this.running = undefined;
        if (this.again) {
          this.again = false;
          this.tick();
        }
      });
  }
}
