import { convertToParamMap } from '@angular/router';
import {
  type FeedFilters,
  clearedFilters,
  filterParams,
  isNarrowed,
  listParams,
  localDayEnd,
  localDayStart,
  readFilters,
} from './feed-query';

const CHANNEL = '0199a0b1-0000-7000-8000-000000000001';

const DEFAULTS: FeedFilters = {
  channelId: null,
  topicId: null,
  category: null,
  from: null,
  to: null,
  sort: 'newest',
  downloaded: 'all',
};

describe('feed filters in the URL', () => {
  it('reads every filter, ignoring malformed values', () => {
    expect(
      readFilters(
        convertToParamMap({
          channel: CHANNEL,
          topic: '12',
          type: 'videos',
          from: '2026-01-01',
          to: '2026-01-31',
          sort: 'oldest',
          downloaded: 'missing',
        }),
      ),
    ).toEqual({
      channelId: CHANNEL,
      topicId: 12,
      category: 'videos',
      from: '2026-01-01',
      to: '2026-01-31',
      sort: 'oldest',
      downloaded: 'missing',
    });
    expect(
      readFilters(
        convertToParamMap({
          channel: 'not-a-uuid',
          topic: '12',
          type: 'holograms',
          from: 'yesterday',
          sort: 'random',
          downloaded: 'maybe',
        }),
      ),
    ).toEqual(DEFAULTS);
  });

  it('lets the page fix a channel, topic, category and default order', () => {
    const scope = {
      channelId: CHANNEL,
      topicId: 7,
      category: 'documents' as const,
      defaultSort: 'oldest' as const,
    };
    const filters = readFilters(convertToParamMap({ channel: 'x', type: 'videos' }), scope);
    expect(filters).toMatchObject({
      channelId: CHANNEL,
      topicId: 7,
      category: 'documents',
      sort: 'oldest',
    });
    // Fixed values and defaults stay out of the URL.
    expect(filterParams(filters, scope)).toEqual({
      channel: null,
      topic: null,
      type: null,
      from: null,
      to: null,
      sort: null,
      downloaded: null,
    });
    expect(filterParams({ ...filters, sort: 'newest' }, scope)['sort']).toBe('newest');
  });

  it('knows when the list is narrowed and how to clear it', () => {
    expect(isNarrowed(DEFAULTS)).toBe(false);
    expect(isNarrowed({ ...DEFAULTS, sort: 'oldest' })).toBe(false);
    expect(isNarrowed({ ...DEFAULTS, downloaded: 'downloaded' })).toBe(true);
    const scope = { channelId: CHANNEL };
    expect(isNarrowed({ ...DEFAULTS, channelId: CHANNEL }, scope)).toBe(false);
    expect(
      clearedFilters(
        { ...DEFAULTS, channelId: CHANNEL, from: '2026-01-01', sort: 'oldest' },
        scope,
      ),
    ).toEqual({ ...DEFAULTS, channelId: CHANNEL, sort: 'oldest' });
  });

  it('asks the api for the types of the category and whole local days', () => {
    const params = listParams({
      ...DEFAULTS,
      channelId: CHANNEL,
      category: 'audio',
      from: '2026-03-05',
      to: '2026-03-06',
      downloaded: 'downloaded',
    });
    expect(params).toEqual({
      channelId: CHANNEL,
      topicId: null,
      types: ['AUDIO', 'VOICE'],
      from: new Date(2026, 2, 5, 0, 0, 0, 0).toISOString(),
      to: new Date(2026, 2, 6, 23, 59, 59, 999).toISOString(),
      downloaded: true,
      sort: 'newest',
    });
    expect(listParams({ ...DEFAULTS, downloaded: 'missing' }).downloaded).toBe(false);
    expect(listParams(DEFAULTS).types).toBeNull();
    expect(Date.parse(localDayEnd('2026-03-05')) - Date.parse(localDayStart('2026-03-05'))).toBe(
      86_400_000 - 1,
    );
  });
});
