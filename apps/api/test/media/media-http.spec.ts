import { describe, expect, it } from 'vitest';
import { ifRangeMatches, parseByteRange } from '../../src/media/byte-range.js';
import { contentDisposition, isInlineType } from '../../src/media/content-disposition.js';

describe('parseByteRange', () => {
  it('reads single ranges, open ends and suffixes', () => {
    expect(parseByteRange('bytes=0-99', 1000)).toEqual({ start: 0, end: 99 });
    expect(parseByteRange('bytes=900-', 1000)).toEqual({ start: 900, end: 999 });
    expect(parseByteRange('bytes=-100', 1000)).toEqual({ start: 900, end: 999 });
    expect(parseByteRange('bytes=-5000', 1000)).toEqual({ start: 0, end: 999 });
    expect(parseByteRange('bytes=990-5000', 1000)).toEqual({ start: 990, end: 999 });
  });

  it('sends the whole file for ranges it does not honour', () => {
    expect(parseByteRange(undefined, 1000)).toBeNull();
    expect(parseByteRange('bytes=0-1,5-6', 1000)).toBeNull();
    expect(parseByteRange('items=0-1', 1000)).toBeNull();
    expect(parseByteRange('bytes=-', 1000)).toBeNull();
  });

  it('refuses ranges outside the file', () => {
    expect(parseByteRange('bytes=1000-', 1000)).toBe('unsatisfiable');
    expect(parseByteRange('bytes=500-100', 1000)).toBe('unsatisfiable');
    expect(parseByteRange('bytes=-0', 1000)).toBe('unsatisfiable');
    expect(parseByteRange('bytes=0-', 0)).toBe('unsatisfiable');
  });
});

describe('content disposition', () => {
  it('shows only safe types inline', () => {
    for (const type of [
      'image/jpeg',
      'image/webp',
      'video/mp4',
      'video/webm',
      'audio/ogg',
      'audio/mpeg',
      'application/pdf',
    ]) {
      expect(isInlineType(type)).toBe(true);
    }
    for (const type of [
      'text/html',
      'image/svg+xml',
      'application/xml',
      'application/javascript',
      'video/quicktime',
      'application/zip',
      'audio/x-list+xml',
      'AUDIO/XML',
    ]) {
      expect(isInlineType(type)).toBe(false);
    }
  });

  it('names files for every browser', () => {
    expect(contentDisposition('attachment', 'Bài giảng "1".pdf')).toBe(
      `attachment; filename="Bai giang _1_.pdf"; filename*=UTF-8''B%C3%A0i%20gi%E1%BA%A3ng%20%221%22.pdf`,
    );
    expect(contentDisposition('inline', "it's (new).mp4")).toBe(
      `inline; filename="it's (new).mp4"; filename*=UTF-8''it%27s%20%28new%29.mp4`,
    );
  });

  it('drops the characters that reverse or hide part of a name', () => {
    expect(contentDisposition('attachment', 'invoice‮fdp.exe')).toBe(
      `attachment; filename="invoicefdp.exe"; filename*=UTF-8''invoicefdp.exe`,
    );
    expect(contentDisposition('attachment', 'a⁦b‏c\r\nd.txt')).toBe(
      `attachment; filename="abcd.txt"; filename*=UTF-8''abcd.txt`,
    );
    expect(contentDisposition('attachment', '‮')).toBe(
      `attachment; filename="file"; filename*=UTF-8''file`,
    );
  });
});

describe('ifRangeMatches', () => {
  const modified = new Date('2026-09-26T10:00:00.000Z');

  it('honours ranges without If-Range, or with our strong ETag or exact date', () => {
    expect(ifRangeMatches(undefined, '"abc"', null)).toBe(true);
    expect(ifRangeMatches('"abc"', '"abc"', null)).toBe(true);
    expect(ifRangeMatches('Sat, 26 Sep 2026 10:00:00 GMT', '"abc"', modified)).toBe(true);
  });

  it('sends the whole file for another version or a weak ETag', () => {
    expect(ifRangeMatches('"old"', '"abc"', modified)).toBe(false);
    expect(ifRangeMatches('W/"abc"', 'W/"abc"', modified)).toBe(false);
    expect(ifRangeMatches('Sat, 26 Sep 2026 09:59:59 GMT', '"abc"', modified)).toBe(false);
    expect(ifRangeMatches('Sat, 26 Sep 2026 10:00:00 GMT', '"abc"', null)).toBe(false);
    expect(ifRangeMatches('not a date', '"abc"', modified)).toBe(false);
  });
});
