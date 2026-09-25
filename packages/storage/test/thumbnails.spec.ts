import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  UnsafeKeyError,
  thumbnailContentType,
  thumbnailExtension,
  thumbnailKey,
  thumbnailPath,
} from '../src/index.js';

const MEDIA_ID = '0199a0b1-0000-7000-8000-00000000c27f';

describe('thumbnail cache layout', () => {
  it('recognises the formats Telegram sends previews in', () => {
    expect(thumbnailExtension(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('jpg');
    expect(
      thumbnailExtension(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    ).toBe('png');
    expect(
      thumbnailExtension(
        new Uint8Array(Buffer.from('RIFF\u0000\u0000\u0000\u0000WEBPVP8 ', 'latin1')),
      ),
    ).toBe('webp');
    expect(thumbnailExtension(new Uint8Array([1, 2, 3]))).toBeNull();
  });

  it('spreads previews over folders by the end of the media id', () => {
    expect(thumbnailKey(MEDIA_ID, 'jpg')).toBe('7f/0199a0b1-0000-7000-8000-00000000c27f.jpg');
    expect(
      thumbnailPath(path.resolve('/cache'), '7f/0199a0b1-0000-7000-8000-00000000c27f.jpg'),
    ).toBe(path.join(path.resolve('/cache'), '7f', '0199a0b1-0000-7000-8000-00000000c27f.jpg'));
    expect(thumbnailContentType('7f/x.webp')).toBe('image/webp');
  });

  it('never leaves the cache', () => {
    expect(() => thumbnailKey('../../etc/passwd', 'jpg')).toThrow(UnsafeKeyError);
    expect(() => thumbnailPath('/cache', '../secret.jpg')).toThrow(UnsafeKeyError);
    expect(() => thumbnailPath('/cache', '7f/0199a0b1-0000-7000-8000-00000000c27f.exe')).toThrow(
      UnsafeKeyError,
    );
  });
});
