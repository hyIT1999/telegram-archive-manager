import { HttpClient, HttpContext } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';
import { ERRORS_SHOWN_INLINE } from '../../core/interceptors/server-error-interceptor';
import type { SettingsDto, UpdateSettingsRequest } from '../../shared/models';

export const SETTINGS_ENDPOINT = '/api/settings';

/** Archive settings kept on the server (`/api/settings`). */
@Injectable({ providedIn: 'root' })
export class SettingsApi {
  private readonly http = inject(HttpClient);

  get(): Observable<SettingsDto> {
    return this.http.get<SettingsDto>(SETTINGS_ENDPOINT);
  }

  /** Changes the given settings; the server applies them to waiting downloads at once. */
  update(request: UpdateSettingsRequest): Observable<SettingsDto> {
    return this.http.patch<SettingsDto>(SETTINGS_ENDPOINT, request, {
      context: new HttpContext().set(ERRORS_SHOWN_INLINE, true),
    });
  }
}
