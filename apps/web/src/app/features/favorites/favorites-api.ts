import { HttpClient, HttpContext } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';
import { ERRORS_SHOWN_INLINE } from '../../core/interceptors/server-error-interceptor';
import type { FavoriteDto } from '../../shared/models';

export const FAVORITE_ENDPOINTS = {
  favorite: (messageId: string) => `/api/messages/${encodeURIComponent(messageId)}/favorite`,
} as const;

@Injectable({ providedIn: 'root' })
export class FavoritesApi {
  private readonly http = inject(HttpClient);

  /**
   * Makes a message a favorite, or not; asking twice changes nothing. Failures are left to the
   * caller, which puts the heart back and says why.
   */
  set(messageId: string, favorite: boolean): Observable<FavoriteDto> {
    const url = FAVORITE_ENDPOINTS.favorite(messageId);
    const context = new HttpContext().set(ERRORS_SHOWN_INLINE, true);
    return favorite
      ? this.http.post<FavoriteDto>(url, {}, { context })
      : this.http.delete<FavoriteDto>(url, { context });
  }
}
