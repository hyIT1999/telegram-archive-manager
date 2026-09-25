import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';
import type { MessageDto, MessagePageDto, MessageSort, MessageType } from '../../shared/models';

export const MESSAGE_ENDPOINTS = {
  list: '/api/messages',
  get: (id: string) => `/api/messages/${encodeURIComponent(id)}`,
} as const;

/** GET /api/messages parameters; unset ones are left out. */
export interface MessageListParams {
  readonly limit?: number;
  readonly cursor?: string | null;
  readonly channelId?: string | null;
  readonly topicId?: number | null;
  readonly types?: readonly MessageType[] | null;
  /** ISO date-times (the web sends the bounds of local days). */
  readonly from?: string | null;
  readonly to?: string | null;
  readonly downloaded?: boolean | null;
  readonly sort?: MessageSort;
}

@Injectable({ providedIn: 'root' })
export class MessagesApi {
  private readonly http = inject(HttpClient);

  /** One page of archived messages, keyset-paginated by `nextCursor`. */
  list(params: MessageListParams): Observable<MessagePageDto> {
    let query = new HttpParams();
    const set = (key: string, value: string | number | boolean | null | undefined) => {
      if (value !== null && value !== undefined && value !== '') {
        query = query.set(key, value);
      }
    };
    set('limit', params.limit);
    set('cursor', params.cursor);
    set('channelId', params.channelId);
    set('topicId', params.topicId);
    set('types', params.types && params.types.length > 0 ? params.types.join(',') : null);
    set('from', params.from);
    set('to', params.to);
    set('downloaded', params.downloaded);
    set('sort', params.sort);
    return this.http.get<MessagePageDto>(MESSAGE_ENDPOINTS.list, { params: query });
  }

  /** One message with its file, album, reply, topic and neighbours. */
  get(id: string): Observable<MessageDto> {
    return this.http.get<MessageDto>(MESSAGE_ENDPOINTS.get(id));
  }
}
