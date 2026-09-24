import { HttpClient, HttpContext, HttpParams, HttpStatusCode } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { type Observable, map } from 'rxjs';
import { ERRORS_SHOWN_INLINE } from '../../core/interceptors/server-error-interceptor';
import type { ChannelDto, Page, UpdateChannelRequest } from '../../shared/models';

export interface ChannelListParams {
  readonly limit?: number;
  readonly cursor?: string | null;
  readonly q?: string;
}

export interface CreatedChannel {
  readonly channel: ChannelDto;
  /** False when the chat was already in the archive (the call is idempotent). */
  readonly created: boolean;
}

@Injectable({ providedIn: 'root' })
export class ChannelsApi {
  private readonly http = inject(HttpClient);

  /** One page of archived channels (`GET /api/channels`), keyset-paginated by `nextCursor`. */
  list(params: ChannelListParams = {}): Observable<Page<ChannelDto>> {
    let httpParams = new HttpParams();
    if (params.limit !== undefined) {
      httpParams = httpParams.set('limit', params.limit);
    }
    if (params.cursor) {
      httpParams = httpParams.set('cursor', params.cursor);
    }
    if (params.q) {
      httpParams = httpParams.set('q', params.q);
    }
    return this.http.get<Page<ChannelDto>>('/api/channels', { params: httpParams });
  }

  /** A single channel with its statistics (`GET /api/channels/:id`). */
  get(id: string): Observable<ChannelDto> {
    return this.http.get<ChannelDto>(`/api/channels/${encodeURIComponent(id)}`);
  }

  /** Chooses where the channel's media is saved (`PATCH /api/channels/:id`). */
  update(id: string, request: UpdateChannelRequest): Observable<ChannelDto> {
    return this.http.patch<ChannelDto>(`/api/channels/${encodeURIComponent(id)}`, request, {
      context: new HttpContext().set(ERRORS_SHOWN_INLINE, true),
    });
  }

  /**
   * Adds a chat from the Telegram chat list to the archive (`POST /api/channels`). The server
   * takes every detail from its own copy of the list; failures are shown where the user added it.
   */
  create(telegramChatId: string): Observable<CreatedChannel> {
    return this.http
      .post<ChannelDto>(
        '/api/channels',
        { telegramChatId },
        { observe: 'response', context: new HttpContext().set(ERRORS_SHOWN_INLINE, true) },
      )
      .pipe(
        map((response) => {
          if (!response.body) {
            throw new Error('The server answered without the channel');
          }
          return { channel: response.body, created: response.status === HttpStatusCode.Created };
        }),
      );
  }
}
