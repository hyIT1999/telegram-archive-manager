import type { HttpTestingController, TestRequest } from '@angular/common/http/testing';
import type { AuthUserDto } from '@tam/shared';
import { AUTH_ENDPOINTS } from '../app/core/auth/auth-service';
import { IMPORT_ENDPOINTS } from '../app/features/imports/imports-api';
import { flushError } from './fixtures';

/**
 * Waits until a request matching `url` is issued (router guards and resources start requests
 * asynchronously) and returns it.
 */
export function nextRequest(http: HttpTestingController, url: string): Promise<TestRequest> {
  return vi.waitFor(() => http.expectOne((request) => request.url === url));
}

/** Waits for the job list request of one type: a channel page asks for its imports and syncs. */
export function nextJobList(
  http: HttpTestingController,
  type: 'IMPORT' | 'SYNC',
): Promise<TestRequest> {
  return vi.waitFor(() =>
    http.expectOne(
      (request) => request.url === IMPORT_ENDPOINTS.jobs && request.params.get('type') === type,
    ),
  );
}

/** Answers the guard's session check: a user means signed in, `null` means 401. */
export async function answerSessionCheck(
  http: HttpTestingController,
  user: AuthUserDto | null,
): Promise<void> {
  const request = await nextRequest(http, AUTH_ENDPOINTS.me);
  if (user) {
    request.flush(user);
  } else {
    flushError(request, 401, 'Unauthorized');
  }
}
