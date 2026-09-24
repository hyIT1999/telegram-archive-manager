import { HttpErrorResponse, type HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { toApiError } from '../../shared/models';
import { NotifyService } from '../services/notify-service';

/**
 * Toasts failures the page cannot explain on its own: the network is down or the server broke.
 * 4xx answers (401, 404, 409, validation) are left to the pages, which show them in context.
 */
export const serverErrorInterceptor: HttpInterceptorFn = (req, next) => {
  const notify = inject(NotifyService);

  return next(req).pipe(
    catchError((error: unknown) => {
      if (error instanceof HttpErrorResponse && (error.status === 0 || error.status >= 500)) {
        notify.error(toApiError(error).message);
      }
      return throwError(() => error);
    }),
  );
};
