import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@tam/database/nest';
import { REDIS_KEYS } from '@tam/shared';
import { AuthRequiredError, type Chat } from '@tam/telegram';
import type { Redis } from 'ioredis';
import { errorMessage } from '../common/error-message.js';
import { BACKUP_NOTES, SYNC_NOTES } from '../common/sync-notes.js';
import { ACCOUNT_KEY, TelegramAuthService } from './telegram-auth.service.js';
import {
  TELEGRAM_API_PROVIDER,
  TELEGRAM_REDIS,
  type TelegramApiProvider,
} from './telegram.tokens.js';

/** The "refreshing" flag expires on its own if the worker dies mid-refresh. */
export const REFRESH_FLAG_TTL_MS = 10 * 60_000;

/**
 * Keeps telegram_dialogs — the cached list of chats the account can access — in step with
 * Telegram. POST /api/channels only accepts chats from this cache, so titles, access hashes and
 * the content-protection flag always come from Telegram, never from a client.
 */
@Injectable()
export class TelegramDialogsService {
  private readonly logger = new Logger(TelegramDialogsService.name);
  private running: Promise<void> | undefined;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(TELEGRAM_API_PROVIDER) private readonly telegram: TelegramApiProvider,
    private readonly auth: TelegramAuthService,
    @Inject(TELEGRAM_REDIS) private readonly redis: Redis,
  ) {}

  /**
   * Starts a background refresh unless one is already running. Resolves once the `refreshing`
   * flag is visible, so an api reading the chat list right after sees the refresh in progress.
   */
  async startRefresh(): Promise<void> {
    await this.auth.requireReady();
    if (this.running) {
      return;
    }
    const flagRaised = this.raiseFlag();
    // Assigned synchronously, so concurrent calls see the running refresh.
    this.running = flagRaised
      .then(() => this.refresh())
      .catch((error: unknown) => {
        this.logger.warn(`Refreshing the chat list failed: ${errorMessage(error)}`);
      })
      .finally(async () => {
        await this.lowerFlag();
        this.running = undefined;
      });
    await flagRaised.catch(() => undefined);
  }

  /** Resolves when no refresh is running (tests, shutdown). */
  async idle(): Promise<void> {
    await this.running;
  }

  /** Stores a complete chat list: upserts every chat and removes the ones no longer seen. */
  async persist(chats: readonly Chat[], seenAt: Date): Promise<void> {
    await this.prisma.$transaction(
      async (tx) => {
        for (const chat of chats) {
          const telegramChatId = BigInt(chat.id);
          const details = {
            title: chat.title,
            username: chat.username,
            type: chat.type,
            accessHash: chat.accessHash === null ? null : BigInt(chat.accessHash),
            isForum: chat.isForum,
            isProtected: chat.isProtected,
            memberCount: chat.memberCount,
          };
          const rights = { canPost: chat.canPost, canManageTopics: chat.canManageTopics };
          await tx.telegramDialog.upsert({
            where: { telegramChatId },
            create: { telegramChatId, ...details, ...rights, lastSeenAt: seenAt },
            update: { ...details, ...rights, lastSeenAt: seenAt },
          });
          // Archived channels follow Telegram; one that turned protected stops syncing and
          // backing up.
          await tx.channel.updateMany({
            where: { telegramChatId },
            data: {
              ...details,
              ...(chat.isProtected
                ? {
                    syncEnabled: false,
                    syncNote: SYNC_NOTES.protected,
                    backupEnabled: false,
                    backupNote: BACKUP_NOTES.protected,
                  }
                : {}),
            },
          });
        }
        await tx.telegramDialog.deleteMany({ where: { lastSeenAt: { lt: seenAt } } });
        await tx.telegramAccount.updateMany({
          where: { accountKey: ACCOUNT_KEY },
          data: { dialogsRefreshedAt: new Date() },
        });
      },
      { timeout: 120_000, maxWait: 10_000 },
    );
  }

  /**
   * Reads one chat again (a backup chat, or one about to become one) into the chat list: its
   * title and forum flag, and whether the account may post and create topics there. The api
   * decides from the stored row once this resolves.
   */
  async checkChat(chatId: string): Promise<void> {
    await this.auth.requireReady();
    let chat: Chat;
    try {
      chat = await this.telegram.api.refreshChat(chatId);
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        await this.auth.markSessionRevoked();
      }
      throw error;
    }
    const telegramChatId = BigInt(chat.id);
    const details = {
      title: chat.title,
      username: chat.username,
      type: chat.type,
      accessHash: chat.accessHash === null ? null : BigInt(chat.accessHash),
      isForum: chat.isForum,
      isProtected: chat.isProtected,
      memberCount: chat.memberCount,
      canPost: chat.canPost,
      canManageTopics: chat.canManageTopics,
      lastSeenAt: new Date(),
    };
    await this.prisma.telegramDialog.upsert({
      where: { telegramChatId },
      create: { telegramChatId, ...details },
      update: details,
    });
  }

  /** The api reports the chat list as `refreshing` while this flag exists. */
  private async raiseFlag(): Promise<void> {
    await this.redis.set(
      REDIS_KEYS.telegramDialogsRefreshing,
      new Date().toISOString(),
      'PX',
      REFRESH_FLAG_TTL_MS,
    );
  }

  private async lowerFlag(): Promise<void> {
    await this.redis.del(REDIS_KEYS.telegramDialogsRefreshing).catch((error: unknown) => {
      this.logger.warn(`Could not clear the refresh flag (it will expire): ${errorMessage(error)}`);
    });
  }

  private async refresh(): Promise<void> {
    const seenAt = new Date();
    try {
      const chats = await this.telegram.api.getChats();
      await this.persist(chats, seenAt);
      this.logger.log(`Chat list refreshed: ${chats.length} channels and groups`);
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        await this.auth.markSessionRevoked();
        return;
      }
      this.logger.warn(`Refreshing the chat list failed: ${errorMessage(error)}`);
    }
  }
}
