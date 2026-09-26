import { describe, expect, it } from 'vitest';
import {
  IMPORT_RUN_ATTEMPTS,
  SEARCH_QUERY_MAX_LENGTH,
  TAG_NAME_MAX_LENGTH,
  addMessageTagRequestSchema,
  appEventSchema,
  createTagRequestSchema,
  cursorQuerySchema,
  importJobListQuerySchema,
  importRequestSchema,
  importRunJobOptions,
  loginRequestSchema,
  messageListQuerySchema,
  newPasswordSchema,
  normalizeTagName,
  rangeEnd,
  rangeStart,
  searchQuerySchema,
  tagNameSchema,
  telegramIdSchema,
  updateTagRequestSchema,
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
  const channelId = '0199a0b1-0000-7000-8000-000000000001';

  it('parses comma separated message types and de-duplicates them', () => {
    const parsed = messageListQuerySchema.parse({ types: 'VIDEO, PHOTO,VIDEO' });
    expect(parsed.types).toEqual(['VIDEO', 'PHOTO']);
    expect(parsed.sort).toBe('newest');
    expect(parsed.limit).toBe(50);
  });

  it('rejects unknown message types', () => {
    expect(messageListQuerySchema.safeParse({ types: 'VIDEO,HOLOGRAM' }).success).toBe(false);
  });

  it('parses the downloaded flag and the topic from a query string', () => {
    const parsed = messageListQuerySchema.parse({ channelId, topicId: '42', downloaded: 'true' });
    expect(parsed).toMatchObject({ channelId, topicId: 42, downloaded: true });
    expect(messageListQuerySchema.parse({ downloaded: 'false' }).downloaded).toBe(false);
  });

  it('needs the channel of a topic', () => {
    const result = messageListQuerySchema.safeParse({ topicId: '42' });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['topicId']);
    expect(messageListQuerySchema.safeParse({ channelId, topicId: '0' }).success).toBe(false);
  });

  it('accepts dates and date-times, but not a range that ends before it starts', () => {
    expect(messageListQuerySchema.safeParse({ from: '2026-01-01', to: '2026-01-01' }).success).toBe(
      true,
    );
    expect(
      messageListQuerySchema.safeParse({
        from: '2026-01-01T00:00:00+07:00',
        to: '2026-01-31T23:59:59.999+07:00',
      }).success,
    ).toBe(true);
    const reversed = messageListQuerySchema.safeParse({ from: '2026-02-01', to: '2026-01-31' });
    expect(reversed.success).toBe(false);
    expect(reversed.error?.issues[0]?.path).toEqual(['from']);
    expect(messageListQuerySchema.safeParse({ from: 'yesterday' }).success).toBe(false);
  });

  it('reads a bare date as a whole UTC day', () => {
    expect(rangeStart('2026-03-05').toISOString()).toBe('2026-03-05T00:00:00.000Z');
    expect(rangeEnd('2026-03-05').toISOString()).toBe('2026-03-05T23:59:59.999Z');
    expect(rangeEnd('2026-03-05T10:00:00+07:00').toISOString()).toBe('2026-03-05T03:00:00.000Z');
  });

  it('filters by tags (at most ten) and favorites', () => {
    const tag = '0199a0b1-0000-7000-8000-00000000000a';
    const parsed = messageListQuerySchema.parse({ tagIds: `${tag},${tag}`, favorite: 'true' });
    expect(parsed).toMatchObject({ tagIds: [tag], favorite: true });
    expect(messageListQuerySchema.safeParse({ tagIds: 'not-a-uuid' }).success).toBe(false);
    const eleven = Array.from(
      { length: 11 },
      (_, index) => `0199a0b1-0000-7000-8000-${String(index).padStart(12, '0')}`,
    );
    expect(messageListQuerySchema.safeParse({ tagIds: eleven.join(',') }).success).toBe(false);
  });

  it('sorts by favorite date only when listing favorites', () => {
    expect(messageListQuerySchema.parse({ sort: 'favorited', favorite: 'true' }).sort).toBe(
      'favorited',
    );
    const result = messageListQuerySchema.safeParse({ sort: 'favorited' });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['sort']);
  });
});

describe('searchQuerySchema', () => {
  it('trims the query and sorts the best matches first by default', () => {
    const parsed = searchQuerySchema.parse({ q: '  bài học  ', types: 'VIDEO' });
    expect(parsed).toMatchObject({ q: 'bài học', sort: 'relevance', types: ['VIDEO'] });
    expect(searchQuerySchema.parse({ q: 'x', sort: 'oldest' }).sort).toBe('oldest');
    expect(searchQuerySchema.safeParse({ q: 'x', sort: 'favorited' }).success).toBe(false);
  });

  it('needs a letter or digit, and at most 200 characters', () => {
    expect(searchQuerySchema.safeParse({}).success).toBe(false);
    expect(searchQuerySchema.safeParse({ q: '   ' }).success).toBe(false);
    expect(searchQuerySchema.safeParse({ q: '#!?' }).success).toBe(false);
    expect(searchQuerySchema.safeParse({ q: '2' }).success).toBe(true);
    expect(
      searchQuerySchema.safeParse({ q: 'a'.repeat(SEARCH_QUERY_MAX_LENGTH + 1) }).success,
    ).toBe(false);
  });

  it('checks the filters like the message list', () => {
    const result = searchQuerySchema.safeParse({ q: 'x', topicId: '42' });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['topicId']);
  });
});

describe('tag schemas', () => {
  it('cleans names and compares them without case', () => {
    expect(createTagRequestSchema.parse({ name: '  Quan   trọng ' })).toEqual({
      name: 'Quan trọng',
    });
    // Decomposed input is stored composed, so it cannot hide a duplicate.
    expect(tagNameSchema.parse('Toán'.normalize('NFD'))).toBe('Toán');
    expect(normalizeTagName(' ĐÃ  Xem ')).toBe('đã xem');
    expect(normalizeTagName('Toán'.normalize('NFD'))).toBe(normalizeTagName('toán'));
  });

  it('rejects empty, long and control-character names', () => {
    expect(tagNameSchema.safeParse('   ').success).toBe(false);
    expect(tagNameSchema.safeParse('a'.repeat(TAG_NAME_MAX_LENGTH)).success).toBe(true);
    expect(tagNameSchema.safeParse('a'.repeat(TAG_NAME_MAX_LENGTH + 1)).success).toBe(false);
    expect(tagNameSchema.safeParse('bell\u0007').success).toBe(false);
  });

  it('takes #rrggbb colors in lower case, or none', () => {
    expect(createTagRequestSchema.parse({ name: 'a', color: '#3F51B5' }).color).toBe('#3f51b5');
    expect(createTagRequestSchema.parse({ name: 'a', color: null }).color).toBeNull();
    expect(createTagRequestSchema.safeParse({ name: 'a', color: 'blue' }).success).toBe(false);
  });

  it('needs something to change', () => {
    expect(updateTagRequestSchema.safeParse({}).success).toBe(false);
    expect(updateTagRequestSchema.parse({ color: null })).toEqual({ color: null });
  });

  it('tags a message with an existing tag or by name', () => {
    const tagId = '0199a0b1-0000-7000-8000-00000000000a';
    expect(addMessageTagRequestSchema.parse({ tagId })).toEqual({ tagId });
    expect(addMessageTagRequestSchema.parse({ name: ' Wave ', color: '#00897B' })).toEqual({
      name: 'Wave',
      color: '#00897b',
    });
    expect(addMessageTagRequestSchema.safeParse({}).success).toBe(false);
    expect(addMessageTagRequestSchema.safeParse({ tagId: 'nope' }).success).toBe(false);
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
