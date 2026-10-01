import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { errorMessage } from '../common/error-message.js';
import { telegramReady } from '../media/telegram-ready.js';
import { TelegramAuthService } from '../telegram/telegram-auth.service.js';
import { TelegramCooldown } from '../telegram/telegram-cooldown.js';
import { TELEGRAM_API_PROVIDER, type TelegramApiProvider } from '../telegram/telegram.tokens.js';
import { BackupSender } from './backup-sender.js';
import { BACKUP_OWNER, BACKUP_TUNING, BackupPolicy, type BackupTuning } from './backup-settings.js';
import { BackupStore } from './backup-store.js';

/**
 * Runs Telegram backups one batch at a time (a message, or an album): the worker's bandwidth goes
 * to one transfer, and the backup chat receives the messages in their order. Starts nothing while
 * backups are paused or Telegram is not ready; new messages of backed-up channels get their rows
 * every minute.
 */
@Injectable()
export class BackupScheduler implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(BackupScheduler.name);
  private readonly shutdown = new AbortController();
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<unknown> | undefined;
  private seededAt = 0;

  constructor(
    private readonly store: BackupStore,
    private readonly sender: BackupSender,
    private readonly policy: BackupPolicy,
    private readonly auth: TelegramAuthService,
    private readonly cooldown: TelegramCooldown,
    @Inject(TELEGRAM_API_PROVIDER) private readonly telegram: TelegramApiProvider,
    @Inject(BACKUP_TUNING) private readonly tuning: BackupTuning,
    @Inject(BACKUP_OWNER) private readonly owner: string,
  ) {}

  onApplicationBootstrap(): void {
    this.tick();
    this.timer = setInterval(() => this.tick(), this.tuning.schedulerIntervalMs);
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

  /** One round: new rows when due, then batches while there is work. Returns the batches run. */
  async round(): Promise<number> {
    if (Date.now() - this.seededAt >= this.tuning.seedIntervalMs) {
      this.seededAt = Date.now();
      await this.store.seedNew();
    }
    let batches = 0;
    while (!this.shutdown.signal.aborted) {
      const settings = await this.policy.current();
      if (settings.paused || !(await telegramReady(this.telegram, this.auth, this.cooldown))) {
        break;
      }
      const batch = await this.store.claim(this.owner);
      if (!batch) {
        break;
      }
      await this.sender.run(batch, this.shutdown.signal);
      batches += 1;
    }
    return batches;
  }

  private tick(): void {
    if (this.running || this.shutdown.signal.aborted) {
      return;
    }
    this.running = this.round()
      .catch((error: unknown) => this.logger.warn(`Backups failed: ${errorMessage(error)}`))
      .finally(() => {
        this.running = undefined;
      });
  }
}
