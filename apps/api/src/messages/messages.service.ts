import { Injectable } from '@nestjs/common';
import type { Channel, Message, Prisma } from '@tam/database';
import { PrismaService } from '@tam/database/nest';
import {
  type MessageDto,
  type MessageListQuery,
  type MessagePageDto,
  type MessageReplyDto,
  MessageType,
  messageCategoryOf,
  messageTypesOf,
  telegramMessageUrl,
} from '@tam/shared';
import { loadMessageBackups } from '../backups/message-backups.js';
import { cappedTotal, TOTAL_COUNT_ROWS } from '../common/pagination/capped-total.js';
import { MEDIA_INCLUDE, toMediaDto } from '../media/media.mapper.js';
import { MESSAGE_TAGS_INCLUDE } from '../tags/tag.mapper.js';
import {
  MESSAGE_SUMMARY_INCLUDE,
  type MessageSummaryRow,
  excerptOf,
  toEntityDtos,
  toForwardDto,
  toMessageMeta,
  toMessageSummaryDto,
} from './message.mapper.js';
import { channelWithOldGroups, messageNotFound, topicTitles } from './message-lookups.js';
import {
  afterCursor,
  beyond,
  decodeMessageCursor,
  encodeMessageCursor,
  messageOrder,
  messageWhere,
} from './message-query.js';

/** An album has at most 10 items; a few more are tolerated, never an unbounded list. */
const ALBUM_LIMIT = 20;

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
      query.channelId === undefined
        ? null
        : await channelWithOldGroups(this.prisma, query.channelId);
    const where = messageWhere(query, channelIds);
    const [rows, total] = await Promise.all([
      this.prisma.message.findMany({
        where: cursor ? { AND: [where, afterCursor(cursor)] } : where,
        orderBy: messageOrder(query.sort),
        take: query.limit + 1,
        include: MESSAGE_SUMMARY_INCLUDE,
      }),
      cursor === undefined ? this.prisma.message.count({ where, take: TOTAL_COUNT_ROWS }) : null,
    ]);
    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    const titles = await topicTitles(this.prisma, page);
    const last = page.at(-1);
    return {
      items: page.map((row) => toMessageSummaryDto(row, titles)),
      nextCursor: hasMore && last ? encodeMessageCursor(query.sort, last) : null,
      ...cappedTotal(total),
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
        tags: MESSAGE_TAGS_INCLUDE,
      },
    });
    if (!message) {
      throw messageNotFound();
    }
    const channel = message.channel;
    const [album, replyTo, previous, next, backups] = await Promise.all([
      this.album(message),
      this.replyTo(message),
      this.neighbour(message, channel, 'newest'),
      this.neighbour(message, channel, 'oldest'),
      loadMessageBackups(this.prisma, message.id),
    ]);
    const row: MessageSummaryRow = { ...message, channel, media: message.media };
    const titles = await topicTitles(this.prisma, [row, ...album]);
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
      favoritedAt: message.favoritedAt?.toISOString() ?? null,
      backups,
    };
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
