import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '@tam/database';
import {
  ApiErrorCode,
  DownloadStatus,
  GENERAL_TOPIC_ID,
  type MessageListQuery,
  type MessageSort,
  MessageType,
  rangeEnd,
  rangeStart,
} from '@tam/shared';
import { z } from 'zod';
import { decodeCursor, encodeCursor } from '../common/pagination/cursor.js';

/** Where a message stands in the list order. */
export interface MessagePosition {
  telegramDate: Date;
  telegramMessageId: number;
  id: string;
}

/** A keyset position plus the order it belongs to, so a cursor never continues another order. */
export interface MessageCursor extends MessagePosition {
  sort: MessageSort;
}

const messageCursorSchema = z
  .tuple([z.enum(['n', 'o']), z.iso.datetime(), z.number().int(), z.uuid()])
  .transform(([sort, date, telegramMessageId, id]): MessageCursor => ({
    sort: sort === 'n' ? 'newest' : 'oldest',
    telegramDate: new Date(date),
    telegramMessageId,
    id,
  }));

export function encodeMessageCursor(sort: MessageSort, position: MessagePosition): string {
  return encodeCursor([
    sort === 'newest' ? 'n' : 'o',
    position.telegramDate.toISOString(),
    position.telegramMessageId,
    position.id,
  ]);
}

/** Decodes a cursor of the same order, or throws 400 INVALID_CURSOR. */
export function decodeMessageCursor(cursor: string, sort: MessageSort): MessageCursor {
  const decoded = decodeCursor(cursor, messageCursorSchema);
  if (decoded.sort !== sort) {
    throw new BadRequestException({
      message: 'The cursor belongs to the other sort order',
      code: ApiErrorCode.INVALID_CURSOR,
    });
  }
  return decoded;
}

/** Newest (or oldest) first; the message id and then the row id break ties. */
export function messageOrder(sort: MessageSort): Prisma.MessageOrderByWithRelationInput[] {
  const direction = sort === 'newest' ? 'desc' : 'asc';
  return [{ telegramDate: direction }, { telegramMessageId: direction }, { id: direction }];
}

/**
 * Messages after `position` in the given order: older ones for `newest`, newer ones for `oldest`.
 * Also finds the neighbours of a message.
 */
export function beyond(position: MessagePosition, sort: MessageSort): Prisma.MessageWhereInput {
  const past = <T>(value: T) => (sort === 'newest' ? { lt: value } : { gt: value });
  return {
    OR: [
      { telegramDate: past(position.telegramDate) },
      { telegramDate: position.telegramDate, telegramMessageId: past(position.telegramMessageId) },
      {
        telegramDate: position.telegramDate,
        telegramMessageId: position.telegramMessageId,
        id: past(position.id),
      },
    ],
  };
}

/**
 * The filters of a message list. `channelIds` is the channel with its old basic groups (null: every
 * channel). Without `types`, service messages (joins, new topics…) are left out.
 */
export function messageWhere(
  query: Omit<MessageListQuery, 'cursor' | 'limit' | 'sort'>,
  channelIds: readonly string[] | null,
): Prisma.MessageWhereInput {
  const and: Prisma.MessageWhereInput[] = [];
  if (channelIds !== null) {
    and.push({ channelId: { in: [...channelIds] } });
  }
  if (query.topicId !== undefined) {
    // The General topic's messages carry no thread id.
    and.push({ threadId: query.topicId === GENERAL_TOPIC_ID ? null : query.topicId });
  }
  and.push(query.types ? { type: { in: query.types } } : { type: { not: MessageType.SERVICE } });
  if (query.from !== undefined) {
    and.push({ telegramDate: { gte: rangeStart(query.from) } });
  }
  if (query.to !== undefined) {
    and.push({ telegramDate: { lte: rangeEnd(query.to) } });
  }
  if (query.downloaded !== undefined) {
    and.push({
      media: {
        some: {
          downloadStatus: query.downloaded
            ? DownloadStatus.DOWNLOADED
            : { not: DownloadStatus.DOWNLOADED },
        },
      },
    });
  }
  return { AND: and };
}
