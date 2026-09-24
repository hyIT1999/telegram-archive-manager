import { describe, expect, it } from 'vitest';
import {
  UnsafeKeyError,
  assertSafeKey,
  buildMediaPath,
  channelFolderName,
  mediaFileName,
  monthFolder,
  sanitizeFileName,
  sanitizeName,
} from '../src/index.js';

describe('readable storage paths', () => {
  it('keeps Vietnamese and other Unicode names readable', () => {
    expect(channelFolderName('Học tập Vật Lý 12', '-1001234567890')).toBe(
      'Học tập Vật Lý 12 (-1001234567890)',
    );
    // Decomposed input (NFD) is stored composed, so the same title always maps to one folder.
    expect(sanitizeName('Ho\u0323c', 20, 'x')).toBe('Học');
  });

  it.each([
    ['a/b\\c:d*e?f"g<h>i|j', 'a_b_c_d_e_f_g_h_i_j'],
    ['  many   spaces\tand\nlines  ', 'many spaces and lines'],
    ['...hidden', 'hidden'],
    ['ends with dots...', 'ends with dots'],
    ['CON', '_CON'],
    ['lpt1.txt', '_lpt1.txt'],
    ['', 'fallback'],
    ['\u0000\u0007', '__'],
  ])('sanitizes %j to %j', (input, expected) => {
    expect(sanitizeName(input, 60, 'fallback')).toBe(expected);
  });

  it('shortens long names by characters, never leaving a trailing space or dot', () => {
    const title = `${'Bài giảng '.repeat(10)}`;
    const name = sanitizeName(title, 20, 'x');
    expect(Array.from(name).length).toBeLessThanOrEqual(20);
    expect(name).toBe('Bài giảng Bài giảng');
    expect(channelFolderName('😀'.repeat(80), '1').startsWith('😀'.repeat(60))).toBe(true);
  });

  it('keeps the extension when shortening file names', () => {
    const long = `${'lecture '.repeat(30)}.mp4`;
    const name = sanitizeFileName(long, 40);
    expect(name.endsWith('.mp4')).toBe(true);
    expect(Array.from(name).length).toBeLessThanOrEqual(40);
    expect(sanitizeFileName('report.final.PDF')).toBe('report.final.PDF');
    expect(sanitizeFileName('.bashrc')).toBe('bashrc');
  });

  it('names media files after the message id', () => {
    expect(mediaFileName({ telegramMessageId: 42, fileName: 'Slides: week 1.pdf' })).toBe(
      '42 - Slides_ week 1.pdf',
    );
    expect(mediaFileName({ telegramMessageId: 43, extension: 'jpg' })).toBe('43.jpg');
    expect(mediaFileName({ telegramMessageId: 44, fileName: '   ', extension: '.mp4' })).toBe('44.mp4');
    expect(mediaFileName({ telegramMessageId: 45 })).toBe('45');
  });

  it('groups files by channel and month (UTC)', () => {
    expect(monthFolder(new Date('2026-01-31T23:30:00-05:00'))).toBe('2026-02');
    expect(
      buildMediaPath({
        channelFolder: channelFolderName('Physics', '-100123'),
        postedAt: new Date('2026-09-24T08:00:00Z'),
        telegramMessageId: 7,
        fileName: 'notes.pdf',
      }),
    ).toBe('Physics (-100123)/2026-09/7 - notes.pdf');
  });

  it('rejects keys that could escape the location or break a platform', () => {
    for (const key of [
      '',
      '../outside',
      'a/../b',
      '/absolute',
      'a//b',
      'a/./b',
      'C:\\Windows',
      'trailing./x',
      ' padded/x',
      'NUL/x',
      'a/b:c',
      `${'x'.repeat(201)}/y`,
    ]) {
      expect(() => assertSafeKey(key), key).toThrow(UnsafeKeyError);
    }
    expect(assertSafeKey('Học (−1)/2026-09/1 - a b.pdf')).toBe('Học (−1)/2026-09/1 - a b.pdf');
    expect(() => channelFolderName('x', '12; rm -rf /')).toThrow(UnsafeKeyError);
  });
});
