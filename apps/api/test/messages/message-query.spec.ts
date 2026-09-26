import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import {
  afterCursor,
  beyond,
  decodeMessageCursor,
  encodeMessageCursor,
  messageOrder,
  messageWhere,
} from '../../src/messages/message-query.js';

const position = {
  telegramDate: new Date('2026-03-01T10:00:00.000Z'),
  telegramMessageId: 42,
  id: '0199a0b1-0000-7000-8000-000000000001',
};
const favoritedAt = new Date('2026-04-02T08:30:00.000Z');

describe('message cursors', () => {
  it('round-trips a position and remembers its order', () => {
    const cursor = encodeMessageCursor('oldest', { ...position, favoritedAt: null });
    expect(decodeMessageCursor(cursor, 'oldest')).toEqual({ sort: 'oldest', ...position });
  });

  it('continues favorites from their favorite date', () => {
    const cursor = encodeMessageCursor('favorited', { ...position, favoritedAt });
    const decoded = decodeMessageCursor(cursor, 'favorited');
    expect(decoded).toEqual({ sort: 'favorited', favoritedAt, id: position.id });
    expect(afterCursor(decoded)).toEqual({
      OR: [{ favoritedAt: { lt: favoritedAt } }, { favoritedAt, id: { lt: position.id } }],
    });
    expect(() => decodeMessageCursor(cursor, 'newest')).toThrow(BadRequestException);
  });

  it('refuses a cursor of the other order, and garbage', () => {
    const cursor = encodeMessageCursor('newest', { ...position, favoritedAt });
    expect(() => decodeMessageCursor(cursor, 'oldest')).toThrow(BadRequestException);
    expect(() => decodeMessageCursor('garbage', 'newest')).toThrow(BadRequestException);
    const forged = Buffer.from(JSON.stringify(['n', 'yesterday', 1, 'x'])).toString('base64url');
    expect(() => decodeMessageCursor(forged, 'newest')).toThrow(BadRequestException);
  });
});

describe('message list order and filters', () => {
  it('sorts by date, then message id, then row id; favorites by favorite date', () => {
    expect(messageOrder('newest')).toEqual([
      { telegramDate: 'desc' },
      { telegramMessageId: 'desc' },
      { id: 'desc' },
    ]);
    expect(messageOrder('oldest')[0]).toEqual({ telegramDate: 'asc' });
    expect(messageOrder('favorited')).toEqual([{ favoritedAt: 'desc' }, { id: 'desc' }]);
  });

  it('continues after a position in either direction', () => {
    expect(beyond(position, 'newest')).toEqual({
      OR: [
        { telegramDate: { lt: position.telegramDate } },
        { telegramDate: position.telegramDate, telegramMessageId: { lt: 42 } },
        { telegramDate: position.telegramDate, telegramMessageId: 42, id: { lt: position.id } },
      ],
    });
    expect(JSON.stringify(beyond(position, 'oldest'))).not.toContain('"lt"');
    expect(afterCursor({ sort: 'newest', ...position })).toEqual(beyond(position, 'newest'));
  });

  it('leaves service messages out unless types are asked for', () => {
    expect(messageWhere({}, null)).toEqual({ AND: [{ type: { not: 'SERVICE' } }] });
    expect(messageWhere({ types: ['SERVICE'] }, null)).toEqual({
      AND: [{ type: { in: ['SERVICE'] } }],
    });
  });

  it('turns every filter into a condition', () => {
    const where = messageWhere(
      {
        channelId: 'c1',
        topicId: 1,
        from: '2026-01-01',
        to: '2026-01-31',
        downloaded: false,
        tagIds: ['t1', 't2'],
        favorite: true,
      },
      ['c1', 'old-group'],
    );
    expect(where.AND).toEqual([
      { channelId: { in: ['c1', 'old-group'] } },
      // The General topic's messages have no thread id.
      { threadId: null },
      { type: { not: 'SERVICE' } },
      { telegramDate: { gte: new Date('2026-01-01T00:00:00.000Z') } },
      { telegramDate: { lte: new Date('2026-01-31T23:59:59.999Z') } },
      { media: { some: { downloadStatus: { not: 'DOWNLOADED' } } } },
      // Every tag must be there.
      { tags: { some: { tagId: 't1' } } },
      { tags: { some: { tagId: 't2' } } },
      { isFavorite: true },
    ]);
    expect(messageWhere({ topicId: 7, downloaded: true }, ['c1']).AND).toContainEqual({
      threadId: 7,
    });
  });
});
