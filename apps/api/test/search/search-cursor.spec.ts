import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { decodeSearchCursor, encodeSearchCursor } from '../../src/search/search-cursor.js';

const hit = {
  id: '0199a0b1-0000-7000-8000-000000000001',
  telegramDate: new Date('2026-03-01T10:00:00.000Z'),
  telegramMessageId: 42,
  rank: '0.0607927',
};

describe('search cursors', () => {
  it('keeps the rank exactly as PostgreSQL printed it', () => {
    const cursor = encodeSearchCursor('relevance', hit);
    expect(decodeSearchCursor(cursor, 'relevance')).toEqual(hit);
    const tiny = encodeSearchCursor('relevance', { ...hit, rank: '6.07927e-05' });
    expect(decodeSearchCursor(tiny, 'relevance').rank).toBe('6.07927e-05');
  });

  it('continues date orders without a rank', () => {
    const cursor = encodeSearchCursor('oldest', hit);
    expect(decodeSearchCursor(cursor, 'oldest')).toEqual({ ...hit, rank: null });
  });

  it('refuses a cursor of another order, a forged rank and garbage', () => {
    const cursor = encodeSearchCursor('newest', hit);
    expect(() => decodeSearchCursor(cursor, 'relevance')).toThrow(BadRequestException);
    const forged = Buffer.from(
      JSON.stringify(['r', '1); DROP TABLE messages', hit.telegramDate.toISOString(), 1, hit.id]),
    ).toString('base64url');
    expect(() => decodeSearchCursor(forged, 'relevance')).toThrow(BadRequestException);
    expect(() => decodeSearchCursor('garbage', 'newest')).toThrow(BadRequestException);
  });
});
