import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { PrismaService } from '@tam/database/nest';
import type { UpdateEvent } from '@tam/telegram';
import { errorMessage } from '../common/error-message.js';
import { TelegramUpdates } from '../telegram/telegram-updates.js';
import {
  SYNCED_CHANNEL,
  SYNC_SCHEDULER_SETTINGS,
  type SyncSchedulerSettings,
} from './sync-settings.js';

/**
 * Notes which synced channels Telegram announced new messages for, and the newest id announced;
 * the SyncScheduler turns that into syncs. Edits and deletions are ignored: the archive keeps
 * what it stored first. Updates of every other chat of the account are dropped here.
 */
@Injectable()
export class NewMessagesListener implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(NewMessagesListener.name);
  /** Channel id → the newest message id Telegram announced and no sync covered yet. */
  private readonly announced = new Map<string, number>();
  /** Telegram chat id → channel id, for the channels that sync. */
  private synced = new Map<string, string>();
  private syncedAt = 0;
  private loading: Promise<void> | undefined;
  private unsubscribe: (() => void) | undefined;

  constructor(
    private readonly prisma: PrismaService,
    private readonly updates: TelegramUpdates,
    @Inject(SYNC_SCHEDULER_SETTINGS) private readonly settings: SyncSchedulerSettings,
  ) {}

  onApplicationBootstrap(): void {
    this.unsubscribe = this.updates.listen((event) => {
      void this.handle(event);
    });
  }

  onModuleDestroy(): void {
    this.unsubscribe?.();
  }

  /** Channels with announced messages, and the newest id announced for each. */
  pending(): ReadonlyMap<string, number> {
    return new Map(this.announced);
  }

  /** A sync read the channel up to `upTo`: forgets it, unless something newer was announced. */
  settle(channelId: string, upTo: number): void {
    const announced = this.announced.get(channelId);
    if (announced !== undefined && announced <= upTo) {
      this.announced.delete(channelId);
    }
  }

  async handle(event: UpdateEvent): Promise<void> {
    if (event.kind !== 'new_message') {
      return;
    }
    try {
      const channelId = (await this.syncedChats()).get(event.chatId);
      const messageId = Number(event.messageId);
      if (channelId !== undefined && messageId > (this.announced.get(channelId) ?? 0)) {
        this.announced.set(channelId, messageId);
      }
    } catch (error) {
      this.logger.warn(`Could not note a new Telegram message: ${errorMessage(error)}`);
    }
  }

  /** Reads the synced chats again at the next update (a switch was flipped, a chat was added). */
  forgetSyncedChats(): void {
    this.syncedAt = 0;
  }

  private async syncedChats(): Promise<ReadonlyMap<string, string>> {
    if (Date.now() - this.syncedAt >= this.settings.syncedChatsMaxAgeMs) {
      this.loading ??= this.loadSyncedChats().finally(() => {
        this.loading = undefined;
      });
      await this.loading;
    }
    return this.synced;
  }

  private async loadSyncedChats(): Promise<void> {
    const rows = await this.prisma.channel.findMany({
      where: SYNCED_CHANNEL,
      select: { id: true, telegramChatId: true },
    });
    this.synced = new Map(rows.map((row) => [row.telegramChatId.toString(), row.id]));
    this.syncedAt = Date.now();
  }
}
