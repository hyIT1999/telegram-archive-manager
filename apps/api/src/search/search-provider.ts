import type { MessageFilters, SearchSort } from '@tam/shared';

/** Where a hit stands in its order. `rank` (relevance only) is kept exactly as the engine gave it. */
export interface SearchPosition {
  id: string;
  telegramDate: Date;
  telegramMessageId: number;
  rank: string | null;
}

export interface SearchRequest {
  /** The words to find, from searchTerms(): folded, at most SEARCH_MAX_TERMS. */
  terms: readonly string[];
  filters: MessageFilters;
  /** The filtered channel with its old basic groups; null without a channel filter. */
  channelIds: readonly string[] | null;
  sort: SearchSort;
  /** Continue after this hit (from the previous page). */
  after: SearchPosition | null;
  limit: number;
  /** Also count every match (for the first page). */
  withTotal: boolean;
}

export interface SearchResult {
  /** The messages found, in order, at most `limit`. */
  hits: SearchPosition[];
  hasMore: boolean;
  total: number | null;
}

/**
 * Finds messages by the words of their text, caption and file names. PostgresSearchProvider uses
 * PostgreSQL full-text search; another engine (OpenSearch, Elasticsearch) can take its place by
 * implementing this class and keeping its own index of those words up to date.
 */
export abstract class SearchProvider {
  abstract search(request: SearchRequest): Promise<SearchResult>;
}
