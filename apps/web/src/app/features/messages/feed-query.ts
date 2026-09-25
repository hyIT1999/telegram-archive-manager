import type { ParamMap, Params } from '@angular/router';
import type { MessageCategory, MessageSort } from '../../shared/models';
import { CATEGORY_TYPES } from './message-labels';
import type { MessageListParams } from './messages-api';

/** Which files a feed shows: all, only downloaded ones, or only the ones not downloaded yet. */
export type DownloadedFilter = 'all' | 'downloaded' | 'missing';

/** What a feed shows. `category` null means every kind of message. */
export interface FeedFilters {
  readonly channelId: string | null;
  readonly topicId: number | null;
  readonly category: MessageCategory | null;
  /** Local days, YYYY-MM-DD, both included. */
  readonly from: string | null;
  readonly to: string | null;
  readonly sort: MessageSort;
  readonly downloaded: DownloadedFilter;
}

/** What the page fixes (a channel page, a topic page, a media section); the URL cannot change it. */
export interface FeedScope {
  readonly channelId?: string | null;
  readonly topicId?: number | null;
  readonly category?: MessageCategory | null;
  readonly defaultSort?: MessageSort;
}

/** Query parameter names; the filters live in the URL so links and Back keep them. */
export const FEED_PARAMS = {
  channel: 'channel',
  topic: 'topic',
  type: 'type',
  from: 'from',
  to: 'to',
  sort: 'sort',
  downloaded: 'downloaded',
} as const;

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isCategory(value: string | null): value is MessageCategory {
  return value !== null && Object.hasOwn(CATEGORY_TYPES, value);
}

/** The filters in the URL, with what the page fixes winning; anything malformed is ignored. */
export function readFilters(params: ParamMap, scope: FeedScope = {}): FeedFilters {
  const channel = params.get(FEED_PARAMS.channel);
  const channelId = scope.channelId ?? (channel !== null && UUID.test(channel) ? channel : null);
  const topic = Number(params.get(FEED_PARAMS.topic) ?? Number.NaN);
  const type = params.get(FEED_PARAMS.type);
  const from = params.get(FEED_PARAMS.from);
  const to = params.get(FEED_PARAMS.to);
  const sort = params.get(FEED_PARAMS.sort);
  const downloaded = params.get(FEED_PARAMS.downloaded);
  return {
    channelId,
    // A topic only means something inside its channel.
    topicId:
      scope.topicId ?? (channelId !== null && Number.isInteger(topic) && topic >= 1 ? topic : null),
    category: scope.category ?? (isCategory(type) ? type : null),
    from: from !== null && DAY.test(from) ? from : null,
    to: to !== null && DAY.test(to) ? to : null,
    sort: sort === 'newest' || sort === 'oldest' ? sort : (scope.defaultSort ?? 'newest'),
    downloaded: downloaded === 'downloaded' || downloaded === 'missing' ? downloaded : 'all',
  };
}

/** Query parameters for `filters`: defaults and fixed values are removed (null). */
export function filterParams(filters: FeedFilters, scope: FeedScope = {}): Params {
  return {
    [FEED_PARAMS.channel]: scope.channelId ? null : filters.channelId,
    [FEED_PARAMS.topic]: scope.topicId ? null : filters.topicId,
    [FEED_PARAMS.type]: scope.category ? null : filters.category,
    [FEED_PARAMS.from]: filters.from,
    [FEED_PARAMS.to]: filters.to,
    [FEED_PARAMS.sort]: filters.sort === (scope.defaultSort ?? 'newest') ? null : filters.sort,
    [FEED_PARAMS.downloaded]: filters.downloaded === 'all' ? null : filters.downloaded,
  };
}

/** Whether anything beyond what the page fixes narrows the list (the sort does not). */
export function isNarrowed(filters: FeedFilters, scope: FeedScope = {}): boolean {
  return (
    (!scope.channelId && filters.channelId !== null) ||
    (!scope.topicId && filters.topicId !== null) ||
    (!scope.category && filters.category !== null) ||
    filters.from !== null ||
    filters.to !== null ||
    filters.downloaded !== 'all'
  );
}

/** The same list without the filters the person chose (the sort stays). */
export function clearedFilters(filters: FeedFilters, scope: FeedScope = {}): FeedFilters {
  return {
    channelId: scope.channelId ?? null,
    topicId: scope.topicId ?? null,
    category: scope.category ?? null,
    from: null,
    to: null,
    sort: filters.sort,
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

/** GET /api/messages parameters for `filters` (days become the bounds of local days). */
export function listParams(filters: FeedFilters): MessageListParams {
  return {
    channelId: filters.channelId,
    topicId: filters.topicId,
    types: filters.category ? CATEGORY_TYPES[filters.category] : null,
    from: filters.from ? localDayStart(filters.from) : null,
    to: filters.to ? localDayEnd(filters.to) : null,
    downloaded: filters.downloaded === 'all' ? null : filters.downloaded === 'downloaded',
    sort: filters.sort,
  };
}
