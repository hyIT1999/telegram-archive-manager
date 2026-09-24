import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';
import type { ChannelDto, Page } from '../../shared/models';

export interface ChannelListParams {
  readonly limit?: number;
  readonly cursor?: string | null;
  readonly q?: string;
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
}
