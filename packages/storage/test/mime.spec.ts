import { describe, expect, it } from 'vitest';
import { extensionFor, mediaFileName } from '../src/index.js';

describe('extensionFor', () => {
  it('knows the MIME types Telegram files usually carry', () => {
    expect(extensionFor('image/jpeg')).toBe('jpg');
    expect(extensionFor('video/quicktime')).toBe('mov');
    expect(
      extensionFor('application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
    ).toBe('docx');
    expect(extensionFor('audio/ogg; codecs=opus')).toBe('ogg');
    expect(extensionFor('Application/PDF')).toBe('pdf');
  });

  it('falls back to the media type, then to nothing', () => {
    expect(extensionFor(null, 'PHOTO')).toBe('jpg');
    expect(extensionFor('application/x-unknown', 'VOICE')).toBe('ogg');
    expect(extensionFor('application/x-unknown', 'DOCUMENT')).toBeNull();
    expect(extensionFor(undefined)).toBeNull();
  });

  it('names photos by message id and extension', () => {
    expect(
      mediaFileName({
        telegramMessageId: 42,
        fileName: null,
        extension: extensionFor('image/jpeg', 'PHOTO'),
      }),
    ).toBe('42.jpg');
  });
});
