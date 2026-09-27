import { HttpClient, HttpContext } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { type Observable, map } from 'rxjs';
import { ERRORS_SHOWN_INLINE } from '../../core/interceptors/server-error-interceptor';
import type {
  ChangePasswordRequest,
  RevokeSessionsResultDto,
  SessionDto,
} from '../../shared/models';

export const ACCOUNT_ENDPOINTS = {
  password: '/api/auth/password',
  sessions: '/api/auth/sessions',
  revokeOthers: '/api/auth/sessions/revoke-others',
} as const;

/** Same policy as the server (newPasswordSchema of @tam/shared). */
export const MIN_PASSWORD_LENGTH = 12;

/** The signed-in user's password and signed-in browsers (`/api/auth/…`). */
@Injectable({ providedIn: 'root' })
export class AccountApi {
  private readonly http = inject(HttpClient);

  /** Other browsers are signed out; this one stays signed in. */
  changePassword(request: ChangePasswordRequest): Observable<void> {
    return this.http
      .post<unknown>(ACCOUNT_ENDPOINTS.password, request, {
        context: new HttpContext().set(ERRORS_SHOWN_INLINE, true),
      })
      .pipe(map(() => undefined));
  }

  sessions(): Observable<SessionDto[]> {
    return this.http.get<SessionDto[]>(ACCOUNT_ENDPOINTS.sessions);
  }

  revokeSession(id: string): Observable<void> {
    return this.http
      .delete<unknown>(`${ACCOUNT_ENDPOINTS.sessions}/${encodeURIComponent(id)}`)
      .pipe(map(() => undefined));
  }

  revokeOtherSessions(): Observable<RevokeSessionsResultDto> {
    return this.http.post<RevokeSessionsResultDto>(ACCOUNT_ENDPOINTS.revokeOthers, null);
  }
}
