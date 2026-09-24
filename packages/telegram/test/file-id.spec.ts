import { describe, expect, it } from 'vitest';
import { FloodWaitError, TelegramError, decodeFileId, encodeFileId } from '../src/index.js';

describe('opaque file ids', () => {
  it('round-trips chat, message and file unique id', () => {
    const parts = { chatId: '-1001234567890', messageId: '42', fileUniqueId: 'AgADvQADr7kxGw' };
    expect(decodeFileId(encodeFileId(parts))).toEqual(parts);
  });

  it('rejects malformed ids', () => {
    for (const bad of ['', '1:2', 'a:2:x', '1:b:x', '1:2:', '1:2:x:y']) {
      expect(() => decodeFileId(bad)).toThrow();
    }
    expect(() => encodeFileId({ chatId: '1', messageId: '2', fileUniqueId: 'a:b' })).toThrow();
  });
});

describe('errors', () => {
  it('exposes codes and flood wait seconds', () => {
    const error = new FloodWaitError(37);
    expect(error).toBeInstanceOf(TelegramError);
    expect(error.code).toBe('FLOOD_WAIT');
    expect(error.seconds).toBe(37);
    expect(error.name).toBe('FloodWaitError');
  });
});
