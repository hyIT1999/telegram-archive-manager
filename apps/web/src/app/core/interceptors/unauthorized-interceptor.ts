import { HttpErrorResponse, type HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { AUTH_ENDPOINTS, AuthService } from '../auth/auth-service';
import { LOGIN_PATH, loginQueryParams } from '../auth/return-url';

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
        auth.clearSession();
        const currentUrl = router.url;
        if (!currentUrl.startsWith(LOGIN_PATH)) {
          void router.navigate([LOGIN_PATH], { queryParams: loginQueryParams(currentUrl) });
        }
      }
      return throwError(() => error);
    }),
  );
};
