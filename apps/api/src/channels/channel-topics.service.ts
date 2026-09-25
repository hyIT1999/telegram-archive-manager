import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { ForumTopic } from '@tam/database';
import { PrismaService } from '@tam/database/nest';
import {
  ApiErrorCode,
  type ForumTopicDto,
  type ForumTopicListDto,
  GENERAL_TOPIC_ID,
  MEDIA_CATEGORIES,
  TelegramErrorCode,
  type TopicCountsDto,
} from '@tam/shared';
import { TelegramRpcClient } from '../telegram/telegram-rpc.client.js';

/** Messages of one topic per category, and its first and last archived message. */
interface TopicCountRow {
  topic_id: number;
  messages: number;
  videos: number;
  images: number;
  documents: number;
  audio: number;
  first_at: Date | null;
  last_at: Date | null;
}

const NO_MESSAGES: TopicCountsDto = { messages: 0, videos: 0, images: 0, documents: 0, audio: 0 };

function channelNotFound(): NotFoundException {
  return new NotFoundException({ message: 'Channel not found', code: ApiErrorCode.NOT_FOUND });
}

/** #rrggbb for an RGB integer. */
export function iconColorHex(color: number | null): string | null {
  return color === null || color < 0 || color > 0xffffff
    ? null
    : `#${color.toString(16).padStart(6, '0')}`;
}

/** The topics of a forum channel: names from Telegram (read by the worker), counts from the archive. */
@Injectable()
export class ChannelTopicsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rpc: TelegramRpcClient,
  ) {}

  async list(channelId: string): Promise<ForumTopicListDto> {
    const channel = await this.prisma.channel.findUnique({
      where: { id: channelId },
      select: { isForum: true, topicsRefreshedAt: true },
    });
    if (!channel) {
      throw channelNotFound();
    }
    const refreshedAt = channel.topicsRefreshedAt?.toISOString() ?? null;
    if (!channel.isForum) {
      return { forum: false, refreshedAt, topics: [] };
    }
    const [named, counted] = await Promise.all([
      this.prisma.forumTopic.findMany({ where: { channelId } }),
      this.prisma.$queryRaw<TopicCountRow[]>`
        SELECT coalesce(thread_id, ${GENERAL_TOPIC_ID}) AS topic_id,
          count(*)::int AS messages,
          count(*) FILTER (WHERE type::text = ANY(${[...MEDIA_CATEGORIES.videos]}))::int AS videos,
          count(*) FILTER (WHERE type::text = ANY(${[...MEDIA_CATEGORIES.images]}))::int AS images,
          count(*) FILTER (WHERE type::text = ANY(${[...MEDIA_CATEGORIES.documents]}))::int AS documents,
          count(*) FILTER (WHERE type::text = ANY(${[...MEDIA_CATEGORIES.audio]}))::int AS audio,
          min(telegram_date) AS first_at,
          max(telegram_date) AS last_at
        FROM messages
        WHERE channel_id = ${channelId}::uuid AND type <> 'SERVICE'
        GROUP BY 1`,
    ]);
    const byId = new Map<number, { row: ForumTopic | null; counts: TopicCountRow | null }>();
    for (const row of named) {
      byId.set(row.topicId, { row, counts: null });
    }
    for (const counts of counted) {
      const entry = byId.get(counts.topic_id);
      byId.set(counts.topic_id, { row: entry?.row ?? null, counts });
    }
    const topics = [...byId.entries()]
      // A hidden General topic without messages is noise.
      .filter(([, entry]) => entry.counts !== null || entry.row?.isHidden !== true)
      .sort(([a], [b]) => a - b)
      .map(([topicId, entry]) => toForumTopicDto(topicId, entry.row, entry.counts));
    return { forum: true, refreshedAt, topics };
  }

  /** Reads the topic names from Telegram again (through the worker), then lists the topics. */
  async refresh(channelId: string): Promise<ForumTopicListDto> {
    const channel = await this.prisma.channel.findUnique({
      where: { id: channelId },
      select: { isForum: true },
    });
    if (!channel) {
      throw channelNotFound();
    }
    if (!channel.isForum) {
      throw new UnprocessableEntityException({
        code: TelegramErrorCode.NOT_A_FORUM,
        message: 'This chat is not a forum, so it has no topics.',
      });
    }
    await this.rpc.call({ method: 'topics.refresh', channelId });
    return this.list(channelId);
  }
}

function toForumTopicDto(
  topicId: number,
  row: ForumTopic | null,
  counts: TopicCountRow | null,
): ForumTopicDto {
  return {
    topicId,
    title: row?.title ?? (topicId === GENERAL_TOPIC_ID ? 'General' : `Topic #${topicId}`),
    iconColor: iconColorHex(row?.iconColor ?? null),
    isClosed: row?.isClosed ?? false,
    isPinned: row?.isPinned ?? false,
    createdAt: row?.telegramDate?.toISOString() ?? null,
    counts: counts
      ? {
          messages: counts.messages,
          videos: counts.videos,
          images: counts.images,
          documents: counts.documents,
          audio: counts.audio,
        }
      : NO_MESSAGES,
    firstPostedAt: counts?.first_at?.toISOString() ?? null,
    lastPostedAt: counts?.last_at?.toISOString() ?? null,
  };
}
