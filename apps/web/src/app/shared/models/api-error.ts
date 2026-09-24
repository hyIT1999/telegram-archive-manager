import { HttpErrorResponse } from '@angular/common/http';
import type { ApiErrorBody } from '@tam/shared';

export const NETWORK_ERROR_MESSAGE = "Can't reach the server. Check your connection and try again.";
export const SERVER_ERROR_MESSAGE = 'The server ran into a problem. Please try again.';
export const UNAVAILABLE_ERROR_MESSAGE =
  'The archive server is not available right now. Please try again shortly.';
export const UNKNOWN_ERROR_MESSAGE = 'Something went wrong. Please try again.';

/** Answers from a proxy (dev server, nginx) or load balancer when the API itself is down. */
const GATEWAY_STATUSES: ReadonlySet<number> = new Set([502, 503, 504]);

/** A failed API call, reduced to what the UI needs. */
export interface ApiError {
  /** HTTP status; 0 when the request never reached the server, null for non-HTTP failures. */
  readonly status: number | null;
  /** Stable machine-readable code from the API body (e.g. WORKER_UNAVAILABLE), if any. */
  readonly code: string | null;
  /** A sentence that can be shown to the user as-is. */
  readonly message: string;
}

/** Normalizes anything thrown by HttpClient (possibly wrapped by a resource) into an ApiError. */
export function toApiError(error: unknown): ApiError {
  const response = findHttpErrorResponse(error);
  if (!response) {
    return { status: null, code: null, message: UNKNOWN_ERROR_MESSAGE };
  }
  const body = readErrorBody(response.error);
  const code = typeof body?.code === 'string' ? body.code : null;

  if (response.status === 0) {
    return { status: 0, code, message: NETWORK_ERROR_MESSAGE };
  }
  if (response.status >= 500) {
    // Only deliberate, coded failures (e.g. 503 WORKER_UNAVAILABLE) carry a user-facing message.
    if (code && body?.message) {
      return { status: response.status, code, message: body.message };
    }
    const message = GATEWAY_STATUSES.has(response.status)
      ? UNAVAILABLE_ERROR_MESSAGE
      : SERVER_ERROR_MESSAGE;
    return { status: response.status, code, message };
  }
  return {
    status: response.status,
    code,
    message: body?.message || `Request failed (${response.status}).`,
  };
}

export function isNotFoundError(error: unknown): boolean {
  const status = findHttpErrorResponse(error)?.status;
  return status === 404;
}

function findHttpErrorResponse(error: unknown): HttpErrorResponse | null {
  if (error instanceof HttpErrorResponse) {
    return error;
  }
  if (error instanceof Error && error.cause !== undefined) {
    return findHttpErrorResponse(error.cause);
  }
  return null;
}

function readErrorBody(value: unknown): Pick<ApiErrorBody, 'message' | 'code'> | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const rawMessage = record['message'];
  const message = Array.isArray(rawMessage)
    ? rawMessage.filter((part) => typeof part === 'string').join(' ')
    : typeof rawMessage === 'string'
      ? rawMessage
      : '';
  const code = typeof record['code'] === 'string' ? record['code'] : undefined;
  return { message, code };
}
