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
  /** Too many failed sign-ins for this email; Retry-After says when to try again. */
  LOGIN_LOCKED: 'LOGIN_LOCKED',
  /** A password change named the wrong current password. */
  CURRENT_PASSWORD_WRONG: 'CURRENT_PASSWORD_WRONG',
  /** The new password is the current one. */
  PASSWORD_UNCHANGED: 'PASSWORD_UNCHANGED',
  /** The Host header names a host this server does not answer for (DNS rebinding guard). */
  HOST_NOT_ALLOWED: 'HOST_NOT_ALLOWED',
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
  /** The account can no longer read the chat (it left, was banned, or the chat is gone). */
  CHAT_UNAVAILABLE: 'CHAT_UNAVAILABLE',
  /** The chat is not a forum, so it has no topics. */
  NOT_A_FORUM: 'NOT_A_FORUM',
  /** Any other Telegram failure. */
  TELEGRAM_ERROR: 'TELEGRAM_ERROR',
} as const;
export type TelegramErrorCode = (typeof TelegramErrorCode)[keyof typeof TelegramErrorCode];

/** Outcomes of import and sync requests (POST /api/channels/:id/import|sync, /api/import-jobs/…). */
export const ImportErrorCode = {
  /** The channel already has an import running with other settings; details.jobId names it. */
  IMPORT_ACTIVE: 'IMPORT_ACTIVE',
  /** The job cannot pause, resume or cancel from its current status. */
  INVALID_JOB_STATE: 'INVALID_JOB_STATE',
  /** The channel is the old basic group of an upgraded supergroup; import the supergroup. */
  CHANNEL_MIGRATED: 'CHANNEL_MIGRATED',
  /** Nothing of the channel is archived yet, so there is nothing to sync from: import it first. */
  SYNC_NEEDS_IMPORT: 'SYNC_NEEDS_IMPORT',
} as const;
export type ImportErrorCode = (typeof ImportErrorCode)[keyof typeof ImportErrorCode];

/** Outcomes of storage location requests (folders on the server, Google Drive). */
export const StorageErrorCode = {
  /** The folder lies outside the roots the server allows (STORAGE_LOCAL_ROOTS). */
  PATH_NOT_ALLOWED: 'PATH_NOT_ALLOWED',
  /** The location cannot be written right now (permissions, full disk, missing folder…). */
  STORAGE_NOT_WRITABLE: 'STORAGE_NOT_WRITABLE',
  /** Another location already writes to the same folder. */
  LOCATION_EXISTS: 'LOCATION_EXISTS',
  /** Channels or stored files still use the location. */
  LOCATION_IN_USE: 'LOCATION_IN_USE',
  /** The location that follows STORAGE_LOCAL_ROOT cannot be removed. */
  LOCATION_BUILT_IN: 'LOCATION_BUILT_IN',
  /** The server lacks the Google OAuth client or STORAGE_SECRET_KEY. */
  GOOGLE_DRIVE_UNAVAILABLE: 'GOOGLE_DRIVE_UNAVAILABLE',
  /** The person did not tick the Google Drive permission on the consent screen. */
  GOOGLE_SCOPE_DENIED: 'GOOGLE_SCOPE_DENIED',
  /** The stored Google grant was revoked or expired: reconnect. */
  GOOGLE_AUTH_REVOKED: 'GOOGLE_AUTH_REVOKED',
  /** Google answered with an error or could not be reached. */
  GOOGLE_DRIVE_ERROR: 'GOOGLE_DRIVE_ERROR',
} as const;
export type StorageErrorCode = (typeof StorageErrorCode)[keyof typeof StorageErrorCode];

/** Outcomes of Telegram backup requests (backup chats, a channel's backup, "Back up now"). */
export const BackupErrorCode = {
  /** The account may not post in that chat: choose one you own or where you may post. */
  BACKUP_CHAT_NOT_WRITABLE: 'BACKUP_CHAT_NOT_WRITABLE',
  /** A forum where the account may not create topics, so topics cannot be mirrored. */
  BACKUP_CHAT_NO_TOPICS: 'BACKUP_CHAT_NO_TOPICS',
  /** The chat is archived as a source; backing up into it would copy the copies. */
  BACKUP_CHAT_ARCHIVED: 'BACKUP_CHAT_ARCHIVED',
  /** The chat receives backups, so it cannot be archived. */
  CHAT_IS_BACKUP_TARGET: 'CHAT_IS_BACKUP_TARGET',
  /** A download location must be a folder or Google Drive; a backup chat must be Telegram. */
  LOCATION_KIND_NOT_ALLOWED: 'LOCATION_KIND_NOT_ALLOWED',
  /** The channel has no backup chat chosen yet. */
  BACKUP_CHAT_MISSING: 'BACKUP_CHAT_MISSING',
  /** The message's backup is running right now; try again when it has finished. */
  BACKUP_ACTIVE: 'BACKUP_ACTIVE',
  /** A service message, a poll or another kind that cannot be recreated. */
  BACKUP_NOT_SUPPORTED: 'BACKUP_NOT_SUPPORTED',
} as const;
export type BackupErrorCode = (typeof BackupErrorCode)[keyof typeof BackupErrorCode];

/** Outcomes of media requests (GET /api/media/:id/content, POST …/download, …/cancel). */
export const DownloadErrorCode = {
  /** The file cannot be cancelled from its current status. */
  INVALID_DOWNLOAD_STATE: 'INVALID_DOWNLOAD_STATE',
  /** The file is not downloaded yet, so there is nothing to show. */
  MEDIA_NOT_DOWNLOADED: 'MEDIA_NOT_DOWNLOADED',
} as const;
export type DownloadErrorCode = (typeof DownloadErrorCode)[keyof typeof DownloadErrorCode];

/** Outcomes of tag requests. */
export const TagErrorCode = {
  /** Another tag has this name (compared without regard to case). */
  TAG_NAME_TAKEN: 'TAG_NAME_TAKEN',
  /** The archive holds MAX_TAGS tags already. */
  TAG_LIMIT_REACHED: 'TAG_LIMIT_REACHED',
} as const;
export type TagErrorCode = (typeof TagErrorCode)[keyof typeof TagErrorCode];

/** One entry of ApiErrorBody.details for a 400 VALIDATION_FAILED response. */
export interface ValidationIssue {
  /** Dotted path of the offending field, e.g. `email` or `items.0.id`; empty for the whole value. */
  path: string;
  message: string;
}
