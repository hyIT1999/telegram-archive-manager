import type { Channel } from '@tam/database';
import { describe, expect, it } from 'vitest';
import { EMPTY_CHANNEL_STATS, toChannelDto } from '../../src/channels/channel.mapper.js';

const channel: Channel = {
  id: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
  // Beyond Number.MAX_SAFE_INTEGER: must survive as an exact string.
  telegramChatId: -1_009_007_199_254_740_993n,
  title: 'Lịch sử Việt Nam',
  username: 'lichsu',
  type: 'CHANNEL',
  accessHash: 1234567890123456789n,
  isForum: false,
  isProtected: false,
  memberCount: 1200,
  syncEnabled: true,
  headMessageId: 5321,
  backfillCursorId: 1,
  backfillComplete: true,
  lastSyncedAt: new Date('2026-09-01T10:00:00.000Z'),
  migratedFromChatId: -4_000_000_001n,
  migratedToChannelId: null,
  createdAt: new Date('2026-08-01T00:00:00.000Z'),
  updatedAt: new Date('2026-09-01T10:00:00.000Z'),
};

describe('toChannelDto', () => {
  it('serializes BIGINT ids as exact strings and dates as ISO strings', () => {
    const dto = toChannelDto(channel, {
      messages: 10,
      media: 4,
      downloadedMedia: 2,
      storageBytes: 2048,
    });
    expect(dto).toEqual({
      id: channel.id,
      telegramChatId: '-1009007199254740993',
      title: 'Lịch sử Việt Nam',
      username: 'lichsu',
      type: 'CHANNEL',
      isProtected: false,
      isForum: false,
      memberCount: 1200,
      syncEnabled: true,
      headMessageId: 5321,
      backfillComplete: true,
      lastSyncedAt: '2026-09-01T10:00:00.000Z',
      migratedToChannelId: null,
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-09-01T10:00:00.000Z',
      stats: { messages: 10, media: 4, downloadedMedia: 2, storageBytes: 2048 },
    });
  });

  it('keeps Telegram internals (access hash, cursors) out of the DTO and is JSON-safe', () => {
    const dto = toChannelDto(channel, EMPTY_CHANNEL_STATS);
    expect(dto).not.toHaveProperty('accessHash');
    expect(dto).not.toHaveProperty('backfillCursorId');
    expect(dto).not.toHaveProperty('migratedFromChatId');
    expect(() => JSON.stringify(dto)).not.toThrow();
    expect(dto.stats).not.toBe(EMPTY_CHANNEL_STATS);
  });
});
