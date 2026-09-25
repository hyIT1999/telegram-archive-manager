import { describe, expect, it } from 'vitest';
import {
  MEDIA_CATEGORIES,
  MESSAGE_CATEGORIES,
  MediaType,
  MessageType,
  jobIds,
  mediaCategoryOf,
  messageCategoryOf,
  messageTypesOf,
  telegramMessageUrl,
} from '../src/index.js';

describe('media categories', () => {
  it('maps every media type to exactly one sidebar category', () => {
    const all = Object.values(MEDIA_CATEGORIES).flat();
    expect([...all].sort()).toEqual(Object.values(MediaType).sort());
    expect(mediaCategoryOf(MediaType.VIDEO_NOTE)).toBe('videos');
    expect(mediaCategoryOf(MediaType.VOICE)).toBe('audio');
  });
});

describe('message categories', () => {
  it('puts every message type but SERVICE into exactly one category', () => {
    const all = MESSAGE_CATEGORIES.flatMap((category) => messageTypesOf(category));
    const withoutService = Object.values(MessageType).filter((type) => type !== 'SERVICE');
    expect([...all].sort()).toEqual(withoutService.sort());
    for (const category of MESSAGE_CATEGORIES) {
      for (const type of messageTypesOf(category)) {
        expect(messageCategoryOf(type)).toBe(category);
      }
    }
    expect(messageCategoryOf(MessageType.SERVICE)).toBeNull();
    expect(messageCategoryOf(MessageType.WEBPAGE)).toBe('text');
    expect(messageCategoryOf(MessageType.ANIMATION)).toBe('videos');
  });
});

describe('telegramMessageUrl', () => {
  it('links public chats by username', () => {
    expect(
      telegramMessageUrl(
        { type: 'CHANNEL', username: 'daily_physics', telegramChatId: '-1001234567890' },
        42,
      ),
    ).toBe('https://t.me/daily_physics/42');
  });

  it('links other channels and supergroups with the members-only t.me/c form', () => {
    expect(
      telegramMessageUrl(
        { type: 'SUPERGROUP', username: null, telegramChatId: '-1001234567890' },
        7,
      ),
    ).toBe('https://t.me/c/1234567890/7');
  });

  it('has no link for basic groups or impossible ids', () => {
    expect(
      telegramMessageUrl({ type: 'GROUP', username: null, telegramChatId: '-4001234' }, 7),
    ).toBeNull();
    const channel = { type: 'CHANNEL' as const, username: null, telegramChatId: '-1001234567890' };
    expect(telegramMessageUrl(channel, 0)).toBeNull();
    expect(telegramMessageUrl(channel, 1.5)).toBeNull();
  });
});

describe('jobIds', () => {
  it('builds BullMQ-safe ids (no colon, never all digits)', () => {
    const ids = [
      jobIds.importRun('0199d6b2-7e4a-7c3e-9b1a-2f4c5d6e7f80', 3),
      jobIds.mediaDownload('42', 0),
      jobIds.mediaDownload('0199d6b2-7e4a-7c3e-9b1a-2f4c5d6e7f80', 12),
    ];
    for (const id of ids) {
      expect(id).not.toContain(':');
      expect(/^\d+$/.test(id)).toBe(false);
    }
    expect(ids[0]).toBe('ij-0199d6b2-7e4a-7c3e-9b1a-2f4c5d6e7f80-3');
    expect(ids[2]).toBe('dl-0199d6b2-7e4a-7c3e-9b1a-2f4c5d6e7f80-12');
  });
});
