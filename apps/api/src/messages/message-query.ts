import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '@tam/database';
import {
  ApiErrorCode,
  DownloadStatus,
  GENERAL_TOPIC_ID,
  type MessageFilters,
  type MessageSort,
  MessageType,
  rangeEnd,
  rangeStart,
} from '@tam/shared';
import { z } from 'zod';
import { decodeCursor, encodeCursor } from '../common/pagination/cursor.js';

/** The orders by posting date. */
export type DateSort = Exclude<MessageSort, 'favorited'>;

/** Where a message stands in the order by posting date. */
export interface MessagePosition {
  telegramDate: Date;
  telegramMessageId: number;
  id: string;
}

/** Where a favorite stands in the order by favorite date. */
export interface FavoritePosition {
  favoritedAt: Date;
  id: string;
}

/** A keyset position plus the order it belongs to, so a cursor never continues another order. */
export type MessageCursor =
  ({ sort: DateSort } & MessagePosition) | ({ sort: 'favorited' } & FavoritePosition);

const messageCursorSchema = z.union([
  z
    .tuple([z.enum(['n', 'o']), z.iso.datetime(), z.number().int(), z.uuid()])
    .transform(([sort, date, telegramMessageId, id]): MessageCursor => ({
      sort: sort === 'n' ? 'newest' : 'oldest',
      telegramDate: new Date(date),
      telegramMessageId,
      id,
    })),
  z
    .tuple([z.literal('f'), z.iso.datetime(), z.uuid()])
    .transform(([, date, id]): MessageCursor => ({
      sort: 'favorited',
      favoritedAt: new Date(date),
      id,
    })),
]);

export function encodeMessageCursor(
  sort: MessageSort,
  row: MessagePosition & { favoritedAt: Date | null },
): string {
  if (sort === 'favorited') {
    // Favorites always have their date; the epoch only guards a row edited by hand.
    return encodeCursor(['f', (row.favoritedAt ?? new Date(0)).toISOString(), row.id]);
  }
  return encodeCursor([
    sort === 'newest' ? 'n' : 'o',
    row.telegramDate.toISOString(),
    row.telegramMessageId,
    row.id,
  ]);
}

/** Decodes a cursor of the same order, or throws 400 INVALID_CURSOR. */
export function decodeMessageCursor(cursor: string, sort: MessageSort): MessageCursor {
  const decoded = decodeCursor(cursor, messageCursorSchema);
  if (decoded.sort !== sort) {
    throw new BadRequestException({
      message: 'The cursor belongs to another sort order',
      code: ApiErrorCode.INVALID_CURSOR,
    });
  }
  return decoded;
}

/**
 * Newest (or oldest) first, the message id and then the row id breaking ties; or the most recently
 * favorited first.
 */
export function messageOrder(sort: MessageSort): Prisma.MessageOrderByWithRelationInput[] {
  if (sort === 'favorited') {
    return [{ favoritedAt: 'desc' }, { id: 'desc' }];
  }
  const direction = sort === 'newest' ? 'desc' : 'asc';
  return [{ telegramDate: direction }, { telegramMessageId: direction }, { id: direction }];
}

/**
 * Messages after `position` in the given order: older ones for `newest`, newer ones for `oldest`.
 * Also finds the neighbours of a message.
 */
export function beyond(position: MessagePosition, sort: DateSort): Prisma.MessageWhereInput {
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

/** The messages that come after a cursor in its order. */
export function afterCursor(cursor: MessageCursor): Prisma.MessageWhereInput {
  if (cursor.sort !== 'favorited') {
    return beyond(cursor, cursor.sort);
  }
  return {
    OR: [
      { favoritedAt: { lt: cursor.favoritedAt } },
      { favoritedAt: cursor.favoritedAt, id: { lt: cursor.id } },
    ],
  };
}

/**
 * The filters of a message list. `channelIds` is the channel with its old basic groups (null: every
 * channel). Without `types`, service messages (joins, new topics…) are left out. Several tags keep
 * the messages that carry all of them.
 */
export function messageWhere(
  filters: MessageFilters,
  channelIds: readonly string[] | null,
): Prisma.MessageWhereInput {
  const and: Prisma.MessageWhereInput[] = [];
  if (channelIds !== null) {
    and.push({ channelId: { in: [...channelIds] } });
  }
  if (filters.topicId !== undefined) {
    // The General topic's messages carry no thread id.
    and.push({ threadId: filters.topicId === GENERAL_TOPIC_ID ? null : filters.topicId });
  }
  and.push(
    filters.types ? { type: { in: filters.types } } : { type: { not: MessageType.SERVICE } },
  );
  if (filters.from !== undefined) {
    and.push({ telegramDate: { gte: rangeStart(filters.from) } });
  }
  if (filters.to !== undefined) {
    and.push({ telegramDate: { lte: rangeEnd(filters.to) } });
  }
  if (filters.downloaded !== undefined) {
    and.push({
      media: {
        some: {
          downloadStatus: filters.downloaded
            ? DownloadStatus.DOWNLOADED
            : { not: DownloadStatus.DOWNLOADED },
        },
      },
    });
  }
  for (const tagId of filters.tagIds ?? []) {
    and.push({ tags: { some: { tagId } } });
  }
  if (filters.favorite !== undefined) {
    and.push({ isFavorite: filters.favorite });
  }
  return { AND: and };
}
