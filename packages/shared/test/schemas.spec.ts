import { describe, expect, it } from 'vitest';
import {
  appEventSchema,
  cursorQuerySchema,
  importRequestSchema,
  loginRequestSchema,
  messageListQuerySchema,
  newPasswordSchema,
  telegramIdSchema,
} from '../src/index.js';

describe('loginRequestSchema', () => {
  it('trims and lower-cases the email', () => {
    const parsed = loginRequestSchema.parse({ email: '  Admin@Example.COM ', password: 'x' });
    expect(parsed.email).toBe('admin@example.com');
  });

  it('rejects an invalid email and an empty password', () => {
    expect(loginRequestSchema.safeParse({ email: 'nope', password: 'x' }).success).toBe(false);
    expect(loginRequestSchema.safeParse({ email: 'a@b.co', password: '' }).success).toBe(false);
  });
});

describe('newPasswordSchema', () => {
  it('requires at least 12 characters', () => {
    expect(newPasswordSchema.safeParse('short').success).toBe(false);
    expect(newPasswordSchema.safeParse('long-enough-pass').success).toBe(true);
  });
});

describe('cursorQuerySchema', () => {
  it('defaults the limit and coerces strings', () => {
    expect(cursorQuerySchema.parse({}).limit).toBe(50);
    expect(cursorQuerySchema.parse({ limit: '10' }).limit).toBe(10);
  });

  it('rejects limits outside 1..100', () => {
    expect(cursorQuerySchema.safeParse({ limit: '0' }).success).toBe(false);
    expect(cursorQuerySchema.safeParse({ limit: '101' }).success).toBe(false);
  });
});

describe('telegramIdSchema', () => {
  it('accepts marked channel ids and rejects non-numeric input', () => {
    expect(telegramIdSchema.safeParse('-1001234567890').success).toBe(true);
    expect(telegramIdSchema.safeParse('12abc').success).toBe(false);
  });
});

describe('importRequestSchema', () => {
  it('accepts ALL and FROM_DATE with a date', () => {
    expect(importRequestSchema.parse({ mode: 'ALL' })).toEqual({ mode: 'ALL' });
    expect(importRequestSchema.parse({ mode: 'FROM_DATE', fromDate: '2025-01-31' })).toEqual({
      mode: 'FROM_DATE',
      fromDate: '2025-01-31',
    });
  });

  it('requires fromDate for FROM_DATE', () => {
    expect(importRequestSchema.safeParse({ mode: 'FROM_DATE' }).success).toBe(false);
    expect(importRequestSchema.safeParse({ mode: 'SOMETHING' }).success).toBe(false);
  });
});

describe('messageListQuerySchema', () => {
  it('parses comma separated media types and de-duplicates them', () => {
    const parsed = messageListQuerySchema.parse({ mediaTypes: 'VIDEO, PHOTO,VIDEO' });
    expect(parsed.mediaTypes).toEqual(['VIDEO', 'PHOTO']);
    expect(parsed.sort).toBe('newest');
  });

  it('parses the favorite flag from a query string', () => {
    expect(messageListQuerySchema.parse({ favorite: 'true' }).favorite).toBe(true);
    expect(messageListQuerySchema.parse({ favorite: 'false' }).favorite).toBe(false);
  });

  it('rejects unknown media types', () => {
    expect(messageListQuerySchema.safeParse({ mediaTypes: 'VIDEO,HOLOGRAM' }).success).toBe(false);
  });
});

describe('appEventSchema', () => {
  it('discriminates import progress events', () => {
    const event = appEventSchema.parse({
      type: 'import.progress',
      jobId: '0199d6b2-7e4a-7c3e-9b1a-2f4c5d6e7f80',
      channelId: '0199d6b2-7e4a-7c3e-9b1a-2f4c5d6e7f81',
      status: 'RUNNING',
      phase: 'HISTORY',
      processedMessages: 1234,
      totalMessages: 15000,
      totalIsEstimate: false,
      totalMedia: 3200,
      downloadedFiles: 893,
      failedFiles: 12,
      skippedFiles: 0,
      downloadedBytes: 1024,
      totalBytes: 4096,
      currentFile: 'video_001.mp4',
      ts: '2026-09-24T10:00:00.000Z',
    });
    expect(event.type).toBe('import.progress');
  });
});
