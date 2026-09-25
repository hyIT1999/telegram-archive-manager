import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '@tam/database/nest';
import { ApiErrorCode } from '@tam/shared';
import { AuthRequiredError, type ForumTopic, NotAForumError, TelegramError } from '@tam/telegram';
import { TelegramAuthService } from './telegram-auth.service.js';
import { TELEGRAM_API_PROVIDER, type TelegramApiProvider } from './telegram.tokens.js';

/**
 * Keeps forum_topics — the names of a forum's topics — in step with Telegram, so the archive can
 * be browsed topic by topic. A topic that disappears from Telegram keeps its row: its messages
 * stay in the archive under it.
 */
@Injectable()
export class ForumTopicsService {
  /** One refresh per channel at a time; a second caller shares the running one. */
  private readonly running = new Map<string, Promise<number>>();

  constructor(
    private readonly prisma: PrismaService,
    @Inject(TELEGRAM_API_PROVIDER) private readonly telegram: TelegramApiProvider,
    private readonly auth: TelegramAuthService,
  ) {}

  /** Reads the channel's topics from Telegram and stores them; resolves to how many there are. */
  refresh(channelId: string): Promise<number> {
    const current = this.running.get(channelId);
    if (current) {
      return current;
    }
    const work = this.load(channelId).finally(() => this.running.delete(channelId));
    this.running.set(channelId, work);
    return work;
  }

  /** Stores a complete topic list of the channel and records when it was read. */
  async store(
    channelId: string,
    topics: readonly ForumTopic[],
    readAt = new Date(),
  ): Promise<void> {
    await this.prisma.$transaction(
      async (tx) => {
        for (const topic of topics) {
          const details = {
            title: topic.title,
            iconColor: topic.iconColor,
            isClosed: topic.isClosed,
            isPinned: topic.isPinned,
            isHidden: topic.isHidden,
            telegramDate: topic.date,
          };
          await tx.forumTopic.upsert({
            where: { channelId_topicId: { channelId, topicId: topic.id } },
            create: { channelId, topicId: topic.id, ...details },
            update: details,
          });
        }
        await tx.channel.update({ where: { id: channelId }, data: { topicsRefreshedAt: readAt } });
      },
      { timeout: 60_000, maxWait: 10_000 },
    );
  }

  private async load(channelId: string): Promise<number> {
    await this.auth.requireReady();
    const channel = await this.prisma.channel.findUnique({
      where: { id: channelId },
      select: { telegramChatId: true, isForum: true },
    });
    if (!channel) {
      throw new TelegramError('The channel is not in the archive', ApiErrorCode.NOT_FOUND);
    }
    if (!channel.isForum) {
      throw new NotAForumError();
    }
    let topics: ForumTopic[];
    try {
      topics = await this.telegram.api.getForumTopics(channel.telegramChatId.toString());
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        await this.auth.markSessionRevoked();
      } else if (error instanceof NotAForumError) {
        // Topics were switched off in Telegram: stop asking; the chat list refresh agrees.
        await this.prisma.channel.update({
          where: { id: channelId },
          data: { isForum: false, topicsRefreshedAt: new Date() },
        });
      }
      throw error;
    }
    await this.store(channelId, topics);
    return topics.length;
  }
}
