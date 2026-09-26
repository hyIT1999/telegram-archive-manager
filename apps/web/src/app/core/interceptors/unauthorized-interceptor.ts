import { HttpErrorResponse, type HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { AUTH_ENDPOINTS, AuthService } from '../auth/auth-service';
import { sessionExpired } from '../auth/session-expired';

/** 401s from these calls are expected answers ("not signed in", "wrong password"). */
const SESSION_PROBES: ReadonlySet<string> = new Set([AUTH_ENDPOINTS.me, AUTH_ENDPOINTS.login]);

/** An expired or revoked session on any API call sends the user back to the login page. */
export const unauthorizedInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  return next(req).pipe(
    catchError((error: unknown) => {
      const path = req.url.split('?')[0];
      if (
        error instanceof HttpErrorResponse &&
        error.status === 401 &&
        path.startsWith('/api/') &&
        !SESSION_PROBES.has(path)
      ) {
        sessionExpired(auth, router);
      }
      return throwError(() => error);
    }),
  );
};
