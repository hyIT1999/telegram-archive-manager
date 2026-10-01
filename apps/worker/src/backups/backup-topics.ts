import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '@tam/database/nest';
import { TELEGRAM_API_PROVIDER, type TelegramApiProvider } from '../telegram/telegram.tokens.js';
import type { BackupBatch } from './backup-store.js';

/** The General topic of a forum: messages there carry no topic. */
const GENERAL_TOPIC_ID = 1;
/** Telegram's longest topic title. */
const MAX_TOPIC_TITLE = 128;

/**
 * The topics of an archived forum, recreated in a backup chat that is a forum: each source topic
 * gets a topic of the same title (prefixed with the channel's name when the backup chat also
 * receives other channels), created the first time one of its messages is backed up.
 */
@Injectable()
export class BackupTopics {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(TELEGRAM_API_PROVIDER) private readonly telegram: TelegramApiProvider,
  ) {}

  /**
   * The topic of the backup chat for messages of `sourceTopicId`; null when the backup chat is
   * not a forum, or for the General topic.
   */
  async topicFor(batch: BackupBatch, sourceTopicId: number | null): Promise<number | null> {
    if (!batch.location.isForum || sourceTopicId === null || sourceTopicId === GENERAL_TOPIC_ID) {
      return null;
    }
    const key = {
      storageLocationId: batch.location.id,
      channelId: batch.channel.id,
      sourceTopicId,
    };
    const mapped = await this.prisma.backupTopic.findUnique({
      where: { storageLocationId_channelId_sourceTopicId: key },
    });
    if (mapped) {
      return mapped.backupTopicId;
    }
    const title = await this.titleOf(batch, sourceTopicId);
    // A run may have died between creating the topic and recording it: take that one.
    const backupTopicId =
      (await this.madeEarlier(batch, title)) ??
      (await this.telegram.api.createForumTopic(batch.location.chatId, title));
    const row = await this.prisma.backupTopic.upsert({
      where: { storageLocationId_channelId_sourceTopicId: key },
      create: { ...key, backupTopicId, title },
      update: {},
    });
    return row.backupTopicId;
  }

  /** The topic was deleted in the backup chat: the next message creates it again. */
  async forget(batch: BackupBatch, sourceTopicId: number): Promise<void> {
    await this.prisma.backupTopic.deleteMany({
      where: {
        storageLocationId: batch.location.id,
        channelId: batch.channel.id,
        sourceTopicId,
      },
    });
  }

  private async titleOf(batch: BackupBatch, sourceTopicId: number): Promise<string> {
    const topic = await this.prisma.forumTopic.findUnique({
      where: { channelId_topicId: { channelId: batch.channel.id, topicId: sourceTopicId } },
      select: { title: true },
    });
    const name = topic?.title ?? `Topic ${sourceTopicId}`;
    const others = await this.prisma.channel.count({
      where: { backupLocationId: batch.location.id, id: { not: batch.channel.ownerId } },
    });
    const title = others > 0 ? `${batch.channel.title} · ${name}` : name;
    return title.slice(0, MAX_TOPIC_TITLE);
  }

  private async madeEarlier(batch: BackupBatch, title: string): Promise<number | null> {
    const known = await this.prisma.backupTopic.findMany({
      where: { storageLocationId: batch.location.id },
      select: { backupTopicId: true },
    });
    const taken = new Set(known.map((row) => row.backupTopicId));
    const topics = await this.telegram.api.getForumTopics(batch.location.chatId);
    const earlier = topics.find(
      (topic) => topic.createdByMe && topic.title === title && !taken.has(topic.id),
    );
    return earlier?.id ?? null;
  }
}
