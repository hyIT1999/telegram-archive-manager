import type { Router } from '@angular/router';
import type { AuthService } from './auth-service';
import { LOGIN_PATH, loginQueryParams } from './return-url';

/**
 * The session is gone (expired, or revoked elsewhere): forget it and go to the login page, which
 * brings the user back here afterwards.
 */
export function sessionExpired(auth: AuthService, router: Router): void {
  auth.clearSession();
  const currentUrl = router.url;
  if (!currentUrl.startsWith(LOGIN_PATH)) {
    void router.navigate([LOGIN_PATH], { queryParams: loginQueryParams(currentUrl) });
  }
}
