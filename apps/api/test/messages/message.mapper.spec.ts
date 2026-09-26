import { describe, expect, it } from 'vitest';
import { iconColorHex } from '../../src/channels/channel-topics.service.js';
import {
  type MessageSummaryRow,
  excerptOf,
  toEntityDtos,
  toForwardDto,
  toMessageMeta,
  toMessageSummaryDto,
  topicTitle,
} from '../../src/messages/message.mapper.js';

describe('toEntityDtos', () => {
  const text = 'Read the notes: https://example.com and `x = 1`';

  it('keeps the formatting the web renders, outer ranges first', () => {
    expect(
      toEntityDtos(
        [
          { kind: 'url', offset: 16, length: 19 },
          { kind: 'bold', offset: 0, length: 15 },
          { kind: 'italic', offset: 0, length: 4 },
          { kind: 'pre', offset: 40, length: 7, params: { language: 'python' } },
          { kind: 'mention', offset: 5, length: 3 },
        ],
        text,
      ),
    ).toEqual([
      { kind: 'bold', offset: 0, length: 15 },
      { kind: 'italic', offset: 0, length: 4 },
      { kind: 'mention', offset: 5, length: 3 },
      { kind: 'link', offset: 16, length: 19 },
      { kind: 'pre', offset: 40, length: 7, language: 'python' },
    ]);
  });

  it('keeps only safe link targets', () => {
    const links = [
      'https://example.com/a',
      'http://example.com/b',
      'tg://resolve?domain=lessons',
      'mailto:teacher@example.com',
      'javascript:alert(1)',
      ' data:text/html,<script>',
      'ftp://example.com',
    ].map((url) => ({ kind: 'textUrl', offset: 0, length: 4, params: { url } }));
    expect(toEntityDtos(links, text).map((entity) => entity.url)).toEqual([
      'https://example.com/a',
      'http://example.com/b',
      'tg://resolve?domain=lessons',
      'mailto:teacher@example.com',
    ]);
  });

  it('drops unknown kinds, broken ranges and anything that is not an entity', () => {
    expect(
      toEntityDtos(
        [
          { kind: 'customEmoji', offset: 0, length: 2, params: { documentId: '5' } },
          { kind: 'mentionName', offset: 0, length: 4, params: { userId: '42' } },
          { kind: 'bold', offset: -1, length: 3 },
          { kind: 'bold', offset: 0, length: 0 },
          { kind: 'bold', offset: 40, length: 50 },
          { kind: 'bold', offset: '1', length: 2 },
          null,
          'bold',
        ],
        text,
      ),
    ).toEqual([]);
    expect(toEntityDtos({ kind: 'bold' }, text)).toEqual([]);
    expect(toEntityDtos([{ kind: 'bold', offset: 0, length: 1 }], null)).toEqual([]);
  });
});

describe('message details', () => {
  it('cuts excerpts at 500 characters without splitting a character', () => {
    expect(excerptOf(null)).toBeNull();
    expect(excerptOf('')).toBeNull();
    expect(excerptOf('short')).toBe('short');
    expect(excerptOf('x'.repeat(600))).toHaveLength(500);
    // The emoji takes two UTF-16 code units: 498 + 2 fit exactly, 499 + 2 do not.
    expect(excerptOf('x'.repeat(498) + '🎓')).toBe('x'.repeat(498) + '🎓');
    expect(excerptOf('x'.repeat(499) + '🎓')).toBe('x'.repeat(499));
  });

  it('reads the stored forward header and original-message details defensively', () => {
    expect(
      toForwardDto({
        date: '2026-01-01T00:00:00.000Z',
        fromChatId: '-1001',
        fromMessageId: '9',
        senderName: 'Ann',
      }),
    ).toEqual({
      date: '2026-01-01T00:00:00.000Z',
      fromChatId: '-1001',
      fromMessageId: 9,
      senderName: 'Ann',
    });
    expect(toForwardDto({ date: '2026-01-01T00:00:00.000Z', fromMessageId: null })).toEqual({
      date: '2026-01-01T00:00:00.000Z',
      fromChatId: null,
      fromMessageId: null,
      senderName: null,
    });
    expect(toForwardDto(null)).toBeNull();
    expect(toForwardDto({ fromChatId: '-1001' })).toBeNull();

    expect(
      toMessageMeta({ postAuthor: 'Teacher', forwards: 4, pinned: true, senderId: '1' }),
    ).toEqual({
      postAuthor: 'Teacher',
      forwards: 4,
      pinned: true,
      serviceAction: null,
    });
    expect(toMessageMeta({ action: 'messageActionTopicCreate' }).serviceAction).toBe(
      'messageActionTopicCreate',
    );
    expect(toMessageMeta(null)).toEqual({
      postAuthor: null,
      forwards: null,
      pinned: false,
      serviceAction: null,
    });
  });

  it('names topics whose title is unknown', () => {
    expect(topicTitle(1, undefined)).toBe('General');
    expect(topicTitle(42, undefined)).toBe('Topic #42');
    expect(topicTitle(42, 'Optics')).toBe('Optics');
  });

  it('writes topic icon colours as #rrggbb', () => {
    expect(iconColorHex(0x6fb9f0)).toBe('#6fb9f0');
    expect(iconColorHex(0xff)).toBe('#0000ff');
    expect(iconColorHex(null)).toBeNull();
    expect(iconColorHex(-1)).toBeNull();
    expect(iconColorHex(0x1000000)).toBeNull();
  });

  it('lists a message with its favorite flag and tags', () => {
    const row: MessageSummaryRow = {
      id: 'm1',
      channelId: 'c1',
      telegramMessageId: 7,
      type: 'TEXT',
      text: 'Candles',
      caption: null,
      entities: null,
      telegramDate: new Date('2026-01-02T03:04:05.000Z'),
      editDate: null,
      replyToMessageId: null,
      mediaGroupId: null,
      threadId: null,
      forwardInfo: null,
      views: null,
      telegramMeta: null,
      isFavorite: true,
      favoritedAt: new Date('2026-02-01T00:00:00.000Z'),
      createdAt: new Date(),
      updatedAt: new Date(),
      channel: { id: 'c1', title: 'Charts', isForum: false },
      media: [],
      tags: [{ tag: { id: 't1', name: 'Important', color: '#e53935' } }],
    };
    expect(toMessageSummaryDto(row, new Map())).toMatchObject({
      isFavorite: true,
      tags: [{ id: 't1', name: 'Important', color: '#e53935' }],
      excerpt: 'Candles',
      media: null,
    });
  });
});
