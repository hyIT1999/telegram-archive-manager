import { convertToParamMap } from '@angular/router';
import {
  type FeedFilters,
  MAX_FILTER_TAGS,
  clearedFilters,
  feedRequest,
  filterParams,
  isNarrowed,
  localDayEnd,
  localDayStart,
  readFilters,
} from './feed-query';

const CHANNEL = '0199a0b1-0000-7000-8000-000000000001';
const TAG = '0199a0b1-0000-7000-8000-e00000000001';
const OTHER_TAG = '0199a0b1-0000-7000-8000-e00000000002';

const DEFAULTS: FeedFilters = {
  q: '',
  channelId: null,
  topicId: null,
  category: null,
  tagIds: [],
  favorite: false,
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
          q: '  bài học  ',
          channel: CHANNEL,
          topic: '12',
          type: 'videos',
          tags: `${TAG},nope,${TAG},${OTHER_TAG}`,
          favorite: '1',
          from: '2026-01-01',
          to: '2026-01-31',
          sort: 'oldest',
          downloaded: 'missing',
        }),
      ),
    ).toEqual({
      q: 'bài học',
      channelId: CHANNEL,
      topicId: 12,
      category: 'videos',
      tagIds: [TAG, OTHER_TAG],
      favorite: true,
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
          tags: 'x,y',
          favorite: 'yes',
          from: 'yesterday',
          sort: 'random',
          downloaded: 'maybe',
        }),
      ),
    ).toEqual(DEFAULTS);
  });

  it('keeps at most ten tags', () => {
    const tags = Array.from(
      { length: 12 },
      (_, index) => `0199a0b1-0000-7000-8000-e${String(index).padStart(11, '0')}`,
    );
    expect(readFilters(convertToParamMap({ tags: tags.join(',') })).tagIds).toHaveLength(
      MAX_FILTER_TAGS,
    );
  });

  it('orders a search by best match, and favorites by favorite date when asked', () => {
    expect(readFilters(convertToParamMap({ q: 'lens' })).sort).toBe('relevance');
    expect(readFilters(convertToParamMap({ q: 'lens', sort: 'oldest' })).sort).toBe('oldest');
    // Best matches need a search; favorite dates need favorites (and no search).
    expect(readFilters(convertToParamMap({ sort: 'relevance' })).sort).toBe('newest');
    expect(readFilters(convertToParamMap({ sort: 'favorited' })).sort).toBe('newest');
    expect(readFilters(convertToParamMap({ sort: 'favorited', favorite: '1' })).sort).toBe(
      'favorited',
    );
    expect(readFilters(convertToParamMap({ q: 'x', sort: 'favorited', favorite: '1' })).sort).toBe(
      'relevance',
    );
  });

  it('lets the page fix a channel, topic, category, tag, favorites and default order', () => {
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
      q: null,
      channel: null,
      topic: null,
      type: null,
      tags: null,
      favorite: null,
      from: null,
      to: null,
      sort: null,
      downloaded: null,
    });
    expect(filterParams({ ...filters, sort: 'newest' }, scope)['sort']).toBe('newest');

    const favorites = { favorite: true, defaultSort: 'favorited' as const };
    const fixed = readFilters(convertToParamMap({ favorite: '0', tags: TAG }), favorites);
    expect(fixed).toMatchObject({ favorite: true, sort: 'favorited', tagIds: [TAG] });
    expect(filterParams(fixed, favorites)).toMatchObject({ favorite: null, sort: null, tags: TAG });
    expect(readFilters(convertToParamMap({ tags: OTHER_TAG }), { tagId: TAG }).tagIds).toEqual([
      TAG,
    ]);
  });

  it('writes the search, tags and favorites, and drops an order that no longer applies', () => {
    expect(
      filterParams({ ...DEFAULTS, q: 'lens', sort: 'relevance', tagIds: [TAG], favorite: true }),
    ).toMatchObject({ q: 'lens', sort: null, tags: TAG, favorite: '1' });
    expect(filterParams({ ...DEFAULTS, sort: 'favorited' })['sort']).toBeNull();
  });

  it('knows when the list is narrowed and how to clear it', () => {
    expect(isNarrowed(DEFAULTS)).toBe(false);
    expect(isNarrowed({ ...DEFAULTS, sort: 'oldest', q: 'x' })).toBe(false);
    expect(isNarrowed({ ...DEFAULTS, downloaded: 'downloaded' })).toBe(true);
    expect(isNarrowed({ ...DEFAULTS, tagIds: [TAG] })).toBe(true);
    expect(isNarrowed({ ...DEFAULTS, favorite: true })).toBe(true);
    expect(isNarrowed({ ...DEFAULTS, favorite: true }, { favorite: true })).toBe(false);
    const scope = { channelId: CHANNEL };
    expect(isNarrowed({ ...DEFAULTS, channelId: CHANNEL }, scope)).toBe(false);
    expect(
      clearedFilters(
        {
          ...DEFAULTS,
          q: 'lens',
          channelId: CHANNEL,
          from: '2026-01-01',
          tagIds: [TAG],
          sort: 'oldest',
        },
        scope,
      ),
    ).toEqual({ ...DEFAULTS, q: 'lens', channelId: CHANNEL, sort: 'oldest' });
    // Without favorites, their order goes too.
    expect(clearedFilters({ ...DEFAULTS, favorite: true, sort: 'favorited' }).sort).toBe('newest');
  });

  it('lists with GET /api/messages: the types of the category and whole local days', () => {
    const request = feedRequest({
      ...DEFAULTS,
      channelId: CHANNEL,
      category: 'audio',
      tagIds: [TAG],
      favorite: true,
      from: '2026-03-05',
      to: '2026-03-06',
      downloaded: 'downloaded',
    });
    expect(request).toEqual({
      kind: 'list',
      params: {
        channelId: CHANNEL,
        topicId: null,
        types: ['AUDIO', 'VOICE'],
        from: new Date(2026, 2, 5, 0, 0, 0, 0).toISOString(),
        to: new Date(2026, 2, 6, 23, 59, 59, 999).toISOString(),
        downloaded: true,
        tagIds: [TAG],
        favorite: true,
        sort: 'newest',
      },
    });
    expect(feedRequest({ ...DEFAULTS, downloaded: 'missing' }).params.downloaded).toBe(false);
    expect(feedRequest(DEFAULTS).params).toMatchObject({ types: null, favorite: null });
    expect(Date.parse(localDayEnd('2026-03-05')) - Date.parse(localDayStart('2026-03-05'))).toBe(
      86_400_000 - 1,
    );
  });

  it('searches with GET /api/search while there are words to find', () => {
    expect(feedRequest({ ...DEFAULTS, q: 'lens', sort: 'relevance' })).toEqual({
      kind: 'search',
      params: expect.objectContaining({ q: 'lens', sort: 'relevance', types: null }),
    });
  });
});
