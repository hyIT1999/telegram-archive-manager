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
import { BACKUP_OWNER, BACKUP_TUNING, type BackupTuning } from './backup-settings.js';
import { type BackupBatch, BackupStore } from './backup-store.js';

/**
 * Picks up backups whose run died (a crash, a stop, a lost Telegram connection): rows ACTIVE and
 * quiet for longer than a live run ever is, not owned by this process. A run that died before
 * sending goes back in line, keeping what it uploaded. A run that died while sending may have
 * posted: the backup chat is read first, and only a send that did not arrive is sent again,
 * with the same random ids.
 */
@Injectable()
export class BackupReconciler implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(BackupReconciler.name);
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<unknown> | undefined;

  constructor(
    private readonly store: BackupStore,
    private readonly sender: BackupSender,
    private readonly auth: TelegramAuthService,
    private readonly cooldown: TelegramCooldown,
    @Inject(TELEGRAM_API_PROVIDER) private readonly telegram: TelegramApiProvider,
    @Inject(BACKUP_TUNING) private readonly tuning: BackupTuning,
    @Inject(BACKUP_OWNER) private readonly owner: string,
  ) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => this.tick(), this.tuning.reconcileIntervalMs);
    this.timer.unref();
  }

  async onModuleDestroy(): Promise<void> {
    clearInterval(this.timer);
    await this.running;
  }

  /** One pass; returns how many dead runs it settled. */
  async reconcile(): Promise<number> {
    const quietSince = new Date(Date.now() - this.tuning.quietAfterMs);
    const batches = await this.store.deadRuns(this.owner, quietSince);
    let settled = 0;
    for (const batch of batches) {
      const stages = await this.store.stagesOf(batch.items);
      const sending = [...stages.values()].includes('SENDING');
      if (!sending) {
        await this.store.takeBack(
          batch.items,
          'The worker stopped during the backup; it starts again',
        );
        settled += 1;
        continue;
      }
      if (!(await telegramReady(this.telegram, this.auth, this.cooldown))) {
        continue;
      }
      try {
        await this.settleSend(batch);
        settled += 1;
      } catch (error) {
        this.logger.warn(
          `Could not check the backup chat "${batch.location.name}": ${errorMessage(error)}`,
        );
      }
    }
    return settled;
  }

  private async settleSend(batch: BackupBatch): Promise<void> {
    const found = await this.sender.findSent(batch, batch.items);
    if (found === 'none') {
      await this.store.takeBack(
        batch.items,
        'The worker stopped while sending, before the message reached the backup chat; it is sent again',
      );
      return;
    }
    if (found === 'unsure') {
      await this.store.unsure(
        batch.items,
        'The worker stopped while sending, and the copy could not be told apart in the backup chat. Look there before using Retry.',
      );
      return;
    }
    await this.store.adopt(batch.items, found, batch.location.chatId);
  }

  private tick(): void {
    if (this.running) {
      return;
    }
    this.running = this.reconcile()
      .catch((error: unknown) =>
        this.logger.warn(`Checking backups failed: ${errorMessage(error)}`),
      )
      .finally(() => {
        this.running = undefined;
      });
  }
}
