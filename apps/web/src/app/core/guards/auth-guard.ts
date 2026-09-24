import { inject } from '@angular/core';
import { type CanMatchFn, Router } from '@angular/router';
import { map } from 'rxjs';
import { AuthService } from '../auth/auth-service';
import { LOGIN_PATH, loginQueryParams } from '../auth/return-url';

/**
 * Lets the signed-in app shell match only with a session. Using canMatch (not canActivate)
 * means the lazy shell and feature chunks are never downloaded for anonymous visitors.
 */
export const authGuard: CanMatchFn = () => {
  const router = inject(Router);
  const navigation = router.currentNavigation();
  const attemptedUrl = navigation ? router.serializeUrl(navigation.extractedUrl) : router.url;

  return inject(AuthService)
    .ensureSession()
    .pipe(
      map((user) =>
        user
          ? true
          : router.createUrlTree([LOGIN_PATH], { queryParams: loginQueryParams(attemptedUrl) }),
      ),
    );
};
