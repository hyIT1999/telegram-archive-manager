import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';
import type { MediaDto } from '../../shared/models';

export const MEDIA_ENDPOINTS = {
  get: (id: string) => `/api/media/${encodeURIComponent(id)}`,
  /** The stored file; `download` asks the browser to save it instead of showing it. */
  content: (id: string, download = false) =>
    `/api/media/${encodeURIComponent(id)}/content${download ? '?download=1' : ''}`,
  thumbnail: (id: string) => `/api/media/${encodeURIComponent(id)}/thumbnail`,
} as const;

/** Media files (their download and cancel live in DownloadsApi). */
@Injectable({ providedIn: 'root' })
export class MediaApi {
  private readonly http = inject(HttpClient);

  get(id: string): Observable<MediaDto> {
    return this.http.get<MediaDto>(MEDIA_ENDPOINTS.get(id));
  }
}
