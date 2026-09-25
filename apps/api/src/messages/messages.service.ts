import { Injectable, NotFoundException } from '@nestjs/common';
import type { Channel, Message, Prisma } from '@tam/database';
import { PrismaService } from '@tam/database/nest';
import {
  ApiErrorCode,
  type MessageDto,
  type MessageListQuery,
  type MessagePageDto,
  type MessageReplyDto,
  MessageType,
  messageCategoryOf,
  messageTypesOf,
  telegramMessageUrl,
} from '@tam/shared';
import { MEDIA_INCLUDE, toMediaDto } from '../media/media.mapper.js';
import {
  MESSAGE_SUMMARY_INCLUDE,
  type MessageSummaryRow,
  type TopicTitles,
  excerptOf,
  toEntityDtos,
  toForwardDto,
  toMessageMeta,
  toMessageSummaryDto,
  topicIdOf,
  topicKey,
} from './message.mapper.js';
import {
  beyond,
  decodeMessageCursor,
  encodeMessageCursor,
  messageOrder,
  messageWhere,
} from './message-query.js';

/** An album has at most 10 items; a few more are tolerated, never an unbounded list. */
const ALBUM_LIMIT = 20;

function messageNotFound(): NotFoundException {
  return new NotFoundException({ message: 'Message not found', code: ApiErrorCode.NOT_FOUND });
}

function channelNotFound(): NotFoundException {
  return new NotFoundException({ message: 'Channel not found', code: ApiErrorCode.NOT_FOUND });
}

type DetailChannel = Pick<
  Channel,
  'id' | 'title' | 'username' | 'telegramChatId' | 'type' | 'isForum'
>;

/** Archived messages: filtered, keyset-paginated lists and single messages with their context. */
@Injectable()
export class MessagesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: MessageListQuery): Promise<MessagePageDto> {
    const cursor =
      query.cursor === undefined ? undefined : decodeMessageCursor(query.cursor, query.sort);
    const channelIds =
      query.channelId === undefined ? null : await this.channelWithOldGroups(query.channelId);
    const where = messageWhere(query, channelIds);
    const [rows, total] = await Promise.all([
      this.prisma.message.findMany({
        where: cursor ? { AND: [where, beyond(cursor, query.sort)] } : where,
        orderBy: messageOrder(query.sort),
        take: query.limit + 1,
        include: MESSAGE_SUMMARY_INCLUDE,
      }),
      cursor === undefined ? this.prisma.message.count({ where }) : null,
    ]);
    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    const titles = await this.topicTitles(page);
    const last = page.at(-1);
    return {
      items: page.map((row) => toMessageSummaryDto(row, titles)),
      nextCursor: hasMore && last ? encodeMessageCursor(query.sort, last) : null,
      total,
    };
  }

  async get(id: string): Promise<MessageDto> {
    const message = await this.prisma.message.findUnique({
      where: { id },
      include: {
        channel: {
          select: {
            id: true,
            title: true,
            username: true,
            telegramChatId: true,
            type: true,
            isForum: true,
          },
        },
        media: { orderBy: { createdAt: 'asc' }, take: 1, include: MEDIA_INCLUDE },
      },
    });
    if (!message) {
      throw messageNotFound();
    }
    const channel = message.channel;
    const [album, replyTo, previous, next] = await Promise.all([
      this.album(message),
      this.replyTo(message),
      this.neighbour(message, channel, 'newest'),
      this.neighbour(message, channel, 'oldest'),
    ]);
    const row: MessageSummaryRow = { ...message, channel, media: message.media };
    const titles = await this.topicTitles([row, ...album]);
    const meta = toMessageMeta(message.telegramMeta);
    const file = message.media[0];
    return {
      ...toMessageSummaryDto(row, titles),
      text: message.text,
      caption: message.caption,
      entities: toEntityDtos(message.entities, message.text ?? message.caption),
      editedAt: message.editDate?.toISOString() ?? null,
      views: message.views,
      forwards: meta.forwards,
      postAuthor: meta.postAuthor,
      pinned: meta.pinned,
      serviceAction: meta.serviceAction,
      forward: toForwardDto(message.forwardInfo),
      replyTo,
      album: album.map((item) => toMessageSummaryDto(item, titles)),
      media: file ? toMediaDto(file) : null,
      previousId: previous,
      nextId: next,
      telegramUrl: telegramMessageUrl(
        {
          type: channel.type,
          username: channel.username,
          telegramChatId: channel.telegramChatId.toString(),
        },
        message.telegramMessageId,
      ),
    };
  }

  /** The channel and the old basic groups upgraded into it (404 when the channel is unknown). */
  private async channelWithOldGroups(channelId: string): Promise<string[]> {
    const channel = await this.prisma.channel.findUnique({
      where: { id: channelId },
      select: { id: true, migratedFrom: { select: { id: true } } },
    });
    if (!channel) {
      throw channelNotFound();
    }
    return [channel.id, ...channel.migratedFrom.map((group) => group.id)];
  }

  /** Names of the forum topics the rows belong to. */
  private async topicTitles(rows: readonly MessageSummaryRow[]): Promise<TopicTitles> {
    const forumRows = rows.filter((row) => row.channel.isForum);
    if (forumRows.length === 0) {
      return new Map();
    }
    const topics = await this.prisma.forumTopic.findMany({
      where: {
        channelId: { in: [...new Set(forumRows.map((row) => row.channel.id))] },
        topicId: { in: [...new Set(forumRows.map((row) => topicIdOf(row)))] },
      },
      select: { channelId: true, topicId: true, title: true },
    });
    return new Map(topics.map((topic) => [topicKey(topic.channelId, topic.topicId), topic.title]));
  }

  /** Every message of the album, oldest first; empty outside albums. */
  private album(message: Message): Promise<MessageSummaryRow[]> {
    if (message.mediaGroupId === null) {
      return Promise.resolve([]);
    }
    return this.prisma.message.findMany({
      where: { channelId: message.channelId, mediaGroupId: message.mediaGroupId },
      orderBy: { telegramMessageId: 'asc' },
      take: ALBUM_LIMIT,
      include: MESSAGE_SUMMARY_INCLUDE,
    });
  }

  /**
   * The message a reply answers. In forums every message points at its topic's first message;
   * that is not a reply.
   */
  private async replyTo(message: Message): Promise<MessageReplyDto | null> {
    const target = message.replyToMessageId;
    if (target === null || target === message.threadId) {
      return null;
    }
    const replied = await this.prisma.message.findUnique({
      where: {
        channelId_telegramMessageId: { channelId: message.channelId, telegramMessageId: target },
      },
      select: { id: true, text: true, caption: true },
    });
    return {
      telegramMessageId: target,
      messageId: replied?.id ?? null,
      excerpt: replied ? excerptOf(replied.text ?? replied.caption) : null,
    };
  }

  /**
   * The previous (older, `newest` order) or next (newer, `oldest` order) message of the same
   * channel, forum topic and category: the next lesson in a course.
   */
  private async neighbour(
    message: Message,
    channel: DetailChannel,
    order: 'newest' | 'oldest',
  ): Promise<string | null> {
    const category = messageCategoryOf(message.type);
    const scope: Prisma.MessageWhereInput = {
      channelId: message.channelId,
      type:
        category === null ? { not: MessageType.SERVICE } : { in: [...messageTypesOf(category)] },
      ...(channel.isForum ? { threadId: message.threadId } : {}),
    };
    const found = await this.prisma.message.findFirst({
      where: { AND: [scope, beyond(message, order)] },
      orderBy: messageOrder(order),
      select: { id: true },
    });
    return found?.id ?? null;
  }
}
