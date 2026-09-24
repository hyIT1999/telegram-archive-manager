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
  /** No worker heartbeat: the background worker is not running. */
  WORKER_UNAVAILABLE: 'WORKER_UNAVAILABLE',
  /** The worker runs but nothing holds the Telegram connection (unconfigured or starting). */
  TELEGRAM_UNAVAILABLE: 'TELEGRAM_UNAVAILABLE',
  /** The worker did not answer a Telegram request in time. */
  TELEGRAM_TIMEOUT: 'TELEGRAM_TIMEOUT',
} as const;
export type ApiErrorCode = (typeof ApiErrorCode)[keyof typeof ApiErrorCode];

/**
 * Telegram-specific outcomes, produced by the worker and passed through by the api.
 * Never retried automatically: each one needs the user to do something.
 */
export const TelegramErrorCode = {
  /** The request does not fit the current login state (e.g. a code before a phone number). */
  INVALID_LOGIN_STATE: 'INVALID_LOGIN_STATE',
  /** The account is not logged in to Telegram yet. */
  TELEGRAM_NOT_READY: 'TELEGRAM_NOT_READY',
  PHONE_NUMBER_INVALID: 'PHONE_NUMBER_INVALID',
  PHONE_NUMBER_BANNED: 'PHONE_NUMBER_BANNED',
  PHONE_CODE_INVALID: 'PHONE_CODE_INVALID',
  PHONE_CODE_EXPIRED: 'PHONE_CODE_EXPIRED',
  PASSWORD_INVALID: 'PASSWORD_INVALID',
  /** The number has no Telegram account; third-party apps may not create one. */
  SIGN_UP_REQUIRED: 'SIGN_UP_REQUIRED',
  /** Telegram asks this number to log in with an official app first. */
  PAYMENT_REQUIRED: 'PAYMENT_REQUIRED',
  /** Telegram asks this number to set up a login email in an official app first. */
  EMAIL_REQUIRED: 'EMAIL_REQUIRED',
  /** Telegram rate limit; see retryAfterSeconds. */
  FLOOD_WAIT: 'FLOOD_WAIT',
  /** The Telegram session was revoked (e.g. terminated from a phone). */
  SESSION_REVOKED: 'SESSION_REVOKED',
  DIALOG_NOT_FOUND: 'DIALOG_NOT_FOUND',
  /** Content protection is on; the chat is never archived. */
  CHAT_PROTECTED: 'CHAT_PROTECTED',
  /** Any other Telegram failure. */
  TELEGRAM_ERROR: 'TELEGRAM_ERROR',
} as const;
export type TelegramErrorCode = (typeof TelegramErrorCode)[keyof typeof TelegramErrorCode];

/** One entry of ApiErrorBody.details for a 400 VALIDATION_FAILED response. */
export interface ValidationIssue {
  /** Dotted path of the offending field, e.g. `email` or `items.0.id`; empty for the whole value. */
  path: string;
  message: string;
}
