import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';
import type {
  MessageDto,
  MessagePageDto,
  MessageSort,
  MessageType,
  SearchSort,
} from '../../shared/models';

export const MESSAGE_ENDPOINTS = {
  list: '/api/messages',
  search: '/api/search',
  get: (id: string) => `/api/messages/${encodeURIComponent(id)}`,
} as const;

/** The filters of GET /api/messages and GET /api/search; unset ones are left out. */
export interface MessageFilterParams {
  readonly limit?: number;
  readonly cursor?: string | null;
  readonly channelId?: string | null;
  readonly topicId?: number | null;
  readonly types?: readonly MessageType[] | null;
  /** ISO date-times (the web sends the bounds of local days). */
  readonly from?: string | null;
  readonly to?: string | null;
  readonly downloaded?: boolean | null;
  /** Messages carrying every one of these tags. */
  readonly tagIds?: readonly string[] | null;
  readonly favorite?: boolean | null;
}

/** GET /api/messages parameters. */
export interface MessageListParams extends MessageFilterParams {
  readonly sort?: MessageSort;
}

/** GET /api/search parameters. */
export interface MessageSearchParams extends MessageFilterParams {
  readonly q: string;
  readonly sort?: SearchSort;
}

function filterQuery(params: MessageFilterParams & { sort?: string; q?: string }): HttpParams {
  let query = new HttpParams();
  const set = (key: string, value: string | number | boolean | null | undefined) => {
    if (value !== null && value !== undefined && value !== '') {
      query = query.set(key, value);
    }
  };
  const list = (values: readonly string[] | null | undefined) =>
    values && values.length > 0 ? values.join(',') : null;
  set('q', params.q);
  set('limit', params.limit);
  set('cursor', params.cursor);
  set('channelId', params.channelId);
  set('topicId', params.topicId);
  set('types', list(params.types));
  set('from', params.from);
  set('to', params.to);
  set('downloaded', params.downloaded);
  set('tagIds', list(params.tagIds));
  set('favorite', params.favorite);
  set('sort', params.sort);
  return query;
}

@Injectable({ providedIn: 'root' })
export class MessagesApi {
  private readonly http = inject(HttpClient);

  /** One page of archived messages, keyset-paginated by `nextCursor`. */
  list(params: MessageListParams): Observable<MessagePageDto> {
    return this.http.get<MessagePageDto>(MESSAGE_ENDPOINTS.list, { params: filterQuery(params) });
  }

  /** One page of the messages whose text, caption or file name holds the words of `q`. */
  search(params: MessageSearchParams): Observable<MessagePageDto> {
    return this.http.get<MessagePageDto>(MESSAGE_ENDPOINTS.search, {
      params: filterQuery(params),
    });
  }

  /** One message with its file, album, reply, topic and neighbours. */
  get(id: string): Observable<MessageDto> {
    return this.http.get<MessageDto>(MESSAGE_ENDPOINTS.get(id));
  }
}
