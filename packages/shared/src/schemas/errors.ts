/**
 * Stable machine-readable codes carried in ApiErrorBody.code.
 * Clients may switch on them; the HTTP status stays the primary signal.
 */
export const ApiErrorCode = {
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  INVALID_CURSOR: 'INVALID_CURSOR',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  RATE_LIMITED: 'RATE_LIMITED',
} as const;
export type ApiErrorCode = (typeof ApiErrorCode)[keyof typeof ApiErrorCode];

/** One entry of ApiErrorBody.details for a 400 VALIDATION_FAILED response. */
export interface ValidationIssue {
  /** Dotted path of the offending field, e.g. `email` or `items.0.id`; empty for the whole value. */
  path: string;
  message: string;
}
