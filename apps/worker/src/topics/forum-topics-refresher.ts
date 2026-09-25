import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { PrismaService } from '@tam/database/nest';
import { AuthRequiredError, FloodWaitError, LoginStepError, NotAForumError } from '@tam/telegram';
import { errorMessage } from '../common/error-message.js';
import { telegramReady } from '../media/telegram-ready.js';
import { ForumTopicsService } from '../telegram/forum-topics.service.js';
import { TelegramAuthService } from '../telegram/telegram-auth.service.js';
import { TelegramCooldown } from '../telegram/telegram-cooldown.js';
import {
  TELEGRAM_API_PROVIDER,
  type TelegramApiProvider,
  TelegramUnavailableError,
} from '../telegram/telegram.tokens.js';
import { TOPICS_SETTINGS, type TopicsSettings } from './topics-settings.js';

/**
 * Reads the topic names of archived forums: once when a forum has none yet (so an archive imported
 * before topics were kept gets them within a minute), then again every day. Waits whenever
 * Telegram is not ready or asked to wait, like every other background task.
 */
@Injectable()
export class ForumTopicsRefresher implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(ForumTopicsRefresher.name);
  /** Forums whose last read failed, and when they may be tried again. */
  private readonly failedUntil = new Map<string, number>();
  private readonly shutdown = new AbortController();
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<unknown> | undefined;

  constructor(
    private readonly prisma: PrismaService,
    private readonly topics: ForumTopicsService,
    private readonly auth: TelegramAuthService,
    private readonly cooldown: TelegramCooldown,
    @Inject(TELEGRAM_API_PROVIDER) private readonly telegram: TelegramApiProvider,
    @Inject(TOPICS_SETTINGS) private readonly settings: TopicsSettings,
  ) {}

  onApplicationBootstrap(): void {
    const interval = this.settings.checkIntervalMs;
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

  /** One round: reads the topics of the forums that are due; resolves to how many it read. */
  async refreshDue(): Promise<number> {
    if (!(await telegramReady(this.telegram, this.auth, this.cooldown))) {
      return 0;
    }
    const now = Date.now();
    const due = await this.prisma.channel.findMany({
      where: {
        isForum: true,
        isProtected: false,
        OR: [
          { topicsRefreshedAt: null },
          { topicsRefreshedAt: { lt: new Date(now - this.settings.maxAgeMs) } },
        ],
      },
      select: { id: true, title: true },
      orderBy: [{ topicsRefreshedAt: { sort: 'asc', nulls: 'first' } }, { id: 'asc' }],
    });
    let read = 0;
    for (const channel of due) {
      if (read >= this.settings.batchSize || this.shutdown.signal.aborted) {
        break;
      }
      if ((this.failedUntil.get(channel.id) ?? 0) > now) {
        continue;
      }
      try {
        const count = await this.topics.refresh(channel.id);
        this.failedUntil.delete(channel.id);
        read += 1;
        this.logger.log(`Read ${count} forum topics of "${channel.title}"`);
      } catch (error) {
        if (error instanceof FloodWaitError) {
          this.cooldown.note(error.seconds);
          break;
        }
        if (
          error instanceof AuthRequiredError ||
          error instanceof TelegramUnavailableError ||
          error instanceof LoginStepError
        ) {
          // Not ready after all: the next round tries again.
          break;
        }
        if (error instanceof NotAForumError) {
          // The service marked the channel: it is no longer due.
          continue;
        }
        this.failedUntil.set(channel.id, Date.now() + this.settings.retryAfterFailureMs);
        this.logger.warn(
          `Could not read the forum topics of "${channel.title}": ${errorMessage(error)}`,
        );
      }
    }
    return read;
  }

  private tick(): void {
    if (this.running || this.shutdown.signal.aborted) {
      return;
    }
    this.running = this.refreshDue()
      .catch((error: unknown) => {
        this.logger.warn(`Refreshing forum topics failed: ${errorMessage(error)}`);
      })
      .finally(() => {
        this.running = undefined;
      });
  }
}
