import { describe, expect, it } from 'vitest';
import {
  IMPORT_RUN_ATTEMPTS,
  appEventSchema,
  cursorQuerySchema,
  importJobListQuerySchema,
  importRequestSchema,
  importRunJobOptions,
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

  it('accepts a local midnight with offset but no date in the future', () => {
    expect(
      importRequestSchema.safeParse({ mode: 'FROM_DATE', fromDate: '2026-09-01T00:00:00+07:00' })
        .success,
    ).toBe(true);
    const nextWeek = new Date(Date.now() + 7 * 24 * 60 * 60_000).toISOString();
    const result = importRequestSchema.safeParse({ mode: 'FROM_DATE', fromDate: nextWeek });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe('Pick a date that is not in the future');
  });
});

describe('importJobListQuerySchema', () => {
  it('filters by channel and a comma separated list of statuses', () => {
    const channelId = '0199a0b1-0000-7000-8000-000000000001';
    expect(importJobListQuerySchema.parse({ channelId, status: 'RUNNING,PAUSED,RUNNING' })).toEqual(
      {
        channelId,
        status: ['RUNNING', 'PAUSED'],
        limit: 50,
      },
    );
    expect(importJobListQuerySchema.safeParse({ status: 'STUCK' }).success).toBe(false);
  });
});

describe('importRunJobOptions', () => {
  it('gives every run its own deterministic BullMQ id and retries with backoff', () => {
    const options = importRunJobOptions('0199a0b1-0000-7000-8000-000000000001', 3);
    expect(options.jobId).toBe('ij-0199a0b1-0000-7000-8000-000000000001-3');
    expect(options.attempts).toBe(IMPORT_RUN_ATTEMPTS);
    expect(options.backoff).toEqual({ type: 'exponential', delay: 30_000 });
    expect(options.removeOnComplete).toBe(true);
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
