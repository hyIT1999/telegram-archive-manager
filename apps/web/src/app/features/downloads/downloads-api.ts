import { HttpClient, HttpContext } from '@angular/common/http';
import { Injectable, InjectionToken, inject } from '@angular/core';
import type { Observable } from 'rxjs';
import { ERRORS_SHOWN_INLINE } from '../../core/interceptors/server-error-interceptor';
import type { ChannelDownloadsDto, MediaDto, RetryDownloadsDto } from '../../shared/models';

export const DOWNLOAD_ENDPOINTS = {
  channel: (channelId: string) => `/api/channels/${encodeURIComponent(channelId)}/downloads`,
  retry: (channelId: string) => `/api/channels/${encodeURIComponent(channelId)}/downloads/retry`,
  download: (mediaId: string) => `/api/media/${encodeURIComponent(mediaId)}/download`,
  cancel: (mediaId: string) => `/api/media/${encodeURIComponent(mediaId)}/cancel`,
} as const;

export interface DownloadPolling {
  /** Re-read a channel's downloads this often while files download. */
  readonly activeMs: number;
  /** …and this often otherwise (files may start any time). */
  readonly idleMs: number;
}

/** Polling until live progress over server-sent events arrives (Phase 7). */
export const DOWNLOAD_POLLING = new InjectionToken<DownloadPolling>('DOWNLOAD_POLLING', {
  providedIn: 'root',
  factory: () => ({ activeMs: 2_000, idleMs: 10_000 }),
});

/** Actions report their failures next to the button that started them. */
function inlineErrors(): { context: HttpContext } {
  return { context: new HttpContext().set(ERRORS_SHOWN_INLINE, true) };
}

/** The api's download endpoints: a channel's downloads, retries, and single files. */
@Injectable({ providedIn: 'root' })
export class DownloadsApi {
  private readonly http = inject(HttpClient);

  /** Files per status, running downloads and room in the location (`GET /api/channels/:id/downloads`). */
  channel(channelId: string): Observable<ChannelDownloadsDto> {
    return this.http.get<ChannelDownloadsDto>(DOWNLOAD_ENDPOINTS.channel(channelId));
  }

  /** Puts every failed file of the channel back in line. */
  retryFailed(channelId: string): Observable<RetryDownloadsDto> {
    return this.http.post<RetryDownloadsDto>(
      DOWNLOAD_ENDPOINTS.retry(channelId),
      {},
      inlineErrors(),
    );
  }

  /** Downloads one file now, whatever the channel's switch and the settings say. */
  download(mediaId: string): Observable<MediaDto> {
    return this.http.post<MediaDto>(DOWNLOAD_ENDPOINTS.download(mediaId), {}, inlineErrors());
  }

  /** Stops waiting for (or downloading) one file. */
  cancel(mediaId: string): Observable<MediaDto> {
    return this.http.post<MediaDto>(DOWNLOAD_ENDPOINTS.cancel(mediaId), {}, inlineErrors());
  }
}
