import { inject } from '@angular/core';
import { type CanMatchFn, Router } from '@angular/router';
import { map } from 'rxjs';
import { AuthService } from '../auth/auth-service';
import { safeReturnUrl } from '../auth/return-url';

/** Keeps signed-in users away from the login page by sending them where they were headed. */
export const guestGuard: CanMatchFn = () => {
  const router = inject(Router);
  const returnUrl = router.currentNavigation()?.extractedUrl.queryParamMap.get('returnUrl');

  return inject(AuthService)
    .ensureSession()
    .pipe(map((user) => (user ? router.parseUrl(safeReturnUrl(returnUrl)) : true)));
};
