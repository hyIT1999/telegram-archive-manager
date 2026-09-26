import type { ParamMap, Params } from '@angular/router';
import type { MessageCategory, MessageSort, SearchSort } from '../../shared/models';
import { CATEGORY_TYPES } from './message-labels';
import type { MessageFilterParams, MessageListParams, MessageSearchParams } from './messages-api';

/** Which files a feed shows: all, only downloaded ones, or only the ones not downloaded yet. */
export type DownloadedFilter = 'all' | 'downloaded' | 'missing';

/** How a feed is ordered: `relevance` while searching, `favorited` for favorites. */
export type FeedSort = MessageSort | SearchSort;

/** What a feed shows. `category` null means every kind of message. */
export interface FeedFilters {
  /** Words to search for; empty when not searching. */
  readonly q: string;
  readonly channelId: string | null;
  readonly topicId: number | null;
  readonly category: MessageCategory | null;
  /** Messages carrying every one of these tags. */
  readonly tagIds: readonly string[];
  /** Favorites only. */
  readonly favorite: boolean;
  /** Local days, YYYY-MM-DD, both included. */
  readonly from: string | null;
  readonly to: string | null;
  readonly sort: FeedSort;
  readonly downloaded: DownloadedFilter;
}

/**
 * What the page fixes (a channel page, a topic page, a media section, a tag page, favorites); the
 * URL cannot change it.
 */
export interface FeedScope {
  readonly channelId?: string | null;
  readonly topicId?: number | null;
  readonly category?: MessageCategory | null;
  readonly tagId?: string | null;
  readonly favorite?: boolean;
  /** The order without a search. */
  readonly defaultSort?: MessageSort;
}

/** Query parameter names; the filters live in the URL so links and Back keep them. */
export const FEED_PARAMS = {
  q: 'q',
  channel: 'channel',
  topic: 'topic',
  type: 'type',
  tags: 'tags',
  favorite: 'favorite',
  from: 'from',
  to: 'to',
  sort: 'sort',
  downloaded: 'downloaded',
} as const;

/** Mirrors SEARCH_QUERY_MAX_LENGTH and MAX_FILTER_TAGS of @tam/shared. */
export const MAX_QUERY_LENGTH = 200;
export const MAX_FILTER_TAGS = 10;

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SORTS: readonly FeedSort[] = ['newest', 'oldest', 'favorited', 'relevance'];

function isCategory(value: string | null): value is MessageCategory {
  return value !== null && Object.hasOwn(CATEGORY_TYPES, value);
}

function isSort(value: string | null): value is FeedSort {
  return value !== null && (SORTS as readonly string[]).includes(value);
}

/** The order used when none is chosen: best matches while searching. */
export function defaultSort(scope: FeedScope, q: string): FeedSort {
  return q ? 'relevance' : (scope.defaultSort ?? 'newest');
}

/** Whether an order applies: best matches need a search; favorite dates need favorites only. */
export function sortApplies(sort: FeedSort, q: string, favorite: boolean): boolean {
  if (sort === 'relevance') {
    return q !== '';
  }
  return sort !== 'favorited' || (favorite && q === '');
}

function tagList(value: string | null): string[] {
  const ids = (value ?? '').split(',').filter((id) => UUID.test(id));
  return [...new Set(ids)].slice(0, MAX_FILTER_TAGS);
}

/** The filters in the URL, with what the page fixes winning; anything malformed is ignored. */
export function readFilters(params: ParamMap, scope: FeedScope = {}): FeedFilters {
  const q = (params.get(FEED_PARAMS.q) ?? '').trim().slice(0, MAX_QUERY_LENGTH);
  const channel = params.get(FEED_PARAMS.channel);
  const channelId = scope.channelId ?? (channel !== null && UUID.test(channel) ? channel : null);
  const topic = Number(params.get(FEED_PARAMS.topic) ?? Number.NaN);
  const type = params.get(FEED_PARAMS.type);
  const favorite = scope.favorite ?? params.get(FEED_PARAMS.favorite) === '1';
  const from = params.get(FEED_PARAMS.from);
  const to = params.get(FEED_PARAMS.to);
  const sort = params.get(FEED_PARAMS.sort);
  const downloaded = params.get(FEED_PARAMS.downloaded);
  return {
    q,
    channelId,
    // A topic only means something inside its channel.
    topicId:
      scope.topicId ?? (channelId !== null && Number.isInteger(topic) && topic >= 1 ? topic : null),
    category: scope.category ?? (isCategory(type) ? type : null),
    tagIds: scope.tagId ? [scope.tagId] : tagList(params.get(FEED_PARAMS.tags)),
    favorite,
    from: from !== null && DAY.test(from) ? from : null,
    to: to !== null && DAY.test(to) ? to : null,
    sort: isSort(sort) && sortApplies(sort, q, favorite) ? sort : defaultSort(scope, q),
    downloaded: downloaded === 'downloaded' || downloaded === 'missing' ? downloaded : 'all',
  };
}

/** Query parameters for `filters`: defaults and fixed values are removed (null). */
export function filterParams(filters: FeedFilters, scope: FeedScope = {}): Params {
  const sortKept =
    sortApplies(filters.sort, filters.q, filters.favorite) &&
    filters.sort !== defaultSort(scope, filters.q);
  return {
    [FEED_PARAMS.q]: filters.q || null,
    [FEED_PARAMS.channel]: scope.channelId ? null : filters.channelId,
    [FEED_PARAMS.topic]: scope.topicId ? null : filters.topicId,
    [FEED_PARAMS.type]: scope.category ? null : filters.category,
    [FEED_PARAMS.tags]:
      scope.tagId || filters.tagIds.length === 0 ? null : filters.tagIds.join(','),
    [FEED_PARAMS.favorite]: scope.favorite || !filters.favorite ? null : '1',
    [FEED_PARAMS.from]: filters.from,
    [FEED_PARAMS.to]: filters.to,
    [FEED_PARAMS.sort]: sortKept ? filters.sort : null,
    [FEED_PARAMS.downloaded]: filters.downloaded === 'all' ? null : filters.downloaded,
  };
}

/** Whether anything beyond what the page fixes narrows the list (the search and sort do not). */
export function isNarrowed(filters: FeedFilters, scope: FeedScope = {}): boolean {
  return (
    (!scope.channelId && filters.channelId !== null) ||
    (!scope.topicId && filters.topicId !== null) ||
    (!scope.category && filters.category !== null) ||
    (!scope.tagId && filters.tagIds.length > 0) ||
    (!scope.favorite && filters.favorite) ||
    filters.from !== null ||
    filters.to !== null ||
    filters.downloaded !== 'all'
  );
}

/** The same list without the filters the person chose (the search and a fitting sort stay). */
export function clearedFilters(filters: FeedFilters, scope: FeedScope = {}): FeedFilters {
  const favorite = scope.favorite ?? false;
  return {
    q: filters.q,
    channelId: scope.channelId ?? null,
    topicId: scope.topicId ?? null,
    category: scope.category ?? null,
    tagIds: scope.tagId ? [scope.tagId] : [],
    favorite,
    from: null,
    to: null,
    sort: sortApplies(filters.sort, filters.q, favorite)
      ? filters.sort
      : defaultSort(scope, filters.q),
    downloaded: 'all',
  };
}

/** The instant a local day starts, as ISO. */
export function localDayStart(day: string): string {
  const [year, month, date] = day.split('-').map(Number) as [number, number, number];
  return new Date(year, month - 1, date, 0, 0, 0, 0).toISOString();
}

/** The last instant of a local day, as ISO. */
export function localDayEnd(day: string): string {
  const [year, month, date] = day.split('-').map(Number) as [number, number, number];
  return new Date(year, month - 1, date, 23, 59, 59, 999).toISOString();
}

/** What the filters ask the API for (days become the bounds of local days). */
function filterRequest(filters: FeedFilters): MessageFilterParams {
  return {
    channelId: filters.channelId,
    topicId: filters.topicId,
    types: filters.category ? CATEGORY_TYPES[filters.category] : null,
    from: filters.from ? localDayStart(filters.from) : null,
    to: filters.to ? localDayEnd(filters.to) : null,
    downloaded: filters.downloaded === 'all' ? null : filters.downloaded === 'downloaded',
    tagIds: filters.tagIds,
    favorite: filters.favorite ? true : null,
  };
}

/** The request for `filters`: GET /api/search while searching, GET /api/messages otherwise. */
export type FeedRequest =
  | { readonly kind: 'search'; readonly params: MessageSearchParams }
  | { readonly kind: 'list'; readonly params: MessageListParams };

export function feedRequest(filters: FeedFilters): FeedRequest {
  const { sort } = filters;
  if (filters.q) {
    return {
      kind: 'search',
      params: {
        ...filterRequest(filters),
        q: filters.q,
        sort: sort === 'favorited' ? 'relevance' : sort,
      },
    };
  }
  return {
    kind: 'list',
    params: { ...filterRequest(filters), sort: sort === 'relevance' ? 'newest' : sort },
  };
}
