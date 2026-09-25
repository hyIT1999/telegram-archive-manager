import { HttpClient, HttpContext } from '@angular/common/http';
import { Injectable, InjectionToken, inject } from '@angular/core';
import type { Observable } from 'rxjs';
import { ERRORS_SHOWN_INLINE } from '../../core/interceptors/server-error-interceptor';
import type { ForumTopicListDto } from '../../shared/models';

export const TOPIC_ENDPOINTS = {
  list: (channelId: string) => `/api/channels/${encodeURIComponent(channelId)}/topics`,
  refresh: (channelId: string) => `/api/channels/${encodeURIComponent(channelId)}/topics/refresh`,
} as const;

/** While a forum's topic names were never read, the list is read again this often (ms). */
export const TOPICS_WAIT_POLL_MS = new InjectionToken<number>('TOPICS_WAIT_POLL_MS', {
  providedIn: 'root',
  factory: () => 10_000,
});

@Injectable({ providedIn: 'root' })
export class TopicsApi {
  private readonly http = inject(HttpClient);

  /** The forum topics of a channel with their message counts. */
  list(channelId: string): Observable<ForumTopicListDto> {
    return this.http.get<ForumTopicListDto>(TOPIC_ENDPOINTS.list(channelId));
  }

  /** Reads the topic names from Telegram again; failures are shown next to the button. */
  refresh(channelId: string): Observable<ForumTopicListDto> {
    return this.http.post<ForumTopicListDto>(
      TOPIC_ENDPOINTS.refresh(channelId),
      {},
      { context: new HttpContext().set(ERRORS_SHOWN_INLINE, true) },
    );
  }
}
