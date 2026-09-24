import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import type { LoginRequest } from '@tam/shared';
import { Observable, catchError, map, of, shareReplay, switchMap, tap, throwError } from 'rxjs';
import type { AuthUserDto } from '../../shared/models';

export const AUTH_ENDPOINTS = {
  login: '/api/auth/login',
  logout: '/api/auth/logout',
  me: '/api/auth/me',
} as const;

/**
 * Holds the web session (an httpOnly cookie the browser sends on same-origin /api calls).
 * The UI state lives in signals; the HTTP calls stay RxJS.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly user = signal<AuthUserDto | null>(null);

  /** Settled or in-flight session lookup; `null` means the next caller asks the API. */
  private session$: Observable<AuthUserDto | null> | null = null;

  readonly currentUser = this.user.asReadonly();
  readonly isAuthenticated = computed(() => this.user() !== null);

  /**
   * Resolves the current user, asking `GET /api/auth/me` at most once: guards on every
   * navigation share the cached answer. A 401 is cached as "signed out"; any other failure
   * (API unreachable) is not cached, so the next navigation retries.
   */
  ensureSession(): Observable<AuthUserDto | null> {
    this.session$ ??= this.lookupSession();
    return this.session$;
  }

  login(credentials: LoginRequest): Observable<AuthUserDto> {
    return this.http.post<unknown>(AUTH_ENDPOINTS.login, credentials).pipe(
      // The login body normally is the user; fall back to /me if the API answers without it.
      switchMap((body) =>
        isAuthUser(body) ? of(body) : this.http.get<AuthUserDto>(AUTH_ENDPOINTS.me),
      ),
      tap((user) => this.setSession(user)),
    );
  }

  /** Ends the session on the server. A 401 means it was already gone, which is fine. */
  logout(): Observable<void> {
    return this.http.post<unknown>(AUTH_ENDPOINTS.logout, null).pipe(
      catchError((error: unknown) => (isUnauthorized(error) ? of(null) : throwError(() => error))),
      map(() => undefined),
      tap(() => this.clearSession()),
    );
  }

  /** Forgets the local session, e.g. after the API answered 401 to some request. */
  clearSession(): void {
    this.user.set(null);
    this.session$ = of(null);
  }

  private setSession(user: AuthUserDto): void {
    this.user.set(user);
    this.session$ = of(user);
  }

  private lookupSession(): Observable<AuthUserDto | null> {
    const lookup$: Observable<AuthUserDto | null> = this.http
      .get<AuthUserDto>(AUTH_ENDPOINTS.me)
      .pipe(
        catchError((error: unknown) => {
          if (!isUnauthorized(error) && this.session$ === lookup$) {
            this.session$ = null;
          }
          return of(null);
        }),
        tap((user) => {
          // A login or logout that finished meanwhile is newer than this answer.
          if (this.session$ === lookup$ || this.session$ === null) {
            this.user.set(user);
          }
        }),
        shareReplay({ bufferSize: 1, refCount: false }),
      );
    return lookup$;
  }
}

function isUnauthorized(error: unknown): boolean {
  return error instanceof HttpErrorResponse && error.status === 401;
}

function isAuthUser(value: unknown): value is AuthUserDto {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Partial<AuthUserDto>;
  return typeof candidate.id === 'string' && typeof candidate.email === 'string';
}
