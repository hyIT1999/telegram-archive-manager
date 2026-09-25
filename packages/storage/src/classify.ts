import { StorageAccessError } from './errors.js';
import { GoogleApiError, GoogleAuthRevokedError } from './google/google-oauth.js';

/**
 * How a failed write should be handled. Callers (the download worker) wait before using the
 * location again for the first three, and retry the file later for anything else.
 */
export type StorageFailureKind =
  /** No room: a full disk (below the server's minimum) or a full Google Drive. */
  | 'out-of-space'
  /** Google Drive limits requests or uploads (including its daily upload cap). */
  | 'rate-limited'
  /** Only a person can fix it: reconnect Google, restore a folder, fix permissions. */
  | 'needs-attention'
  /** Anything else: network trouble, a server error, a file that changed while uploading. */
  | 'transient';

const RATE_LIMIT_REASONS = new Set(['rateLimitExceeded', 'userRateLimitExceeded']);
const ATTENTION_REASONS = new Set(['insufficientFilePermissions', 'appNotAuthorizedToFile']);
/** Filesystem errors that stay until someone changes permissions or brings the folder back. */
const ATTENTION_CODES = new Set(['EACCES', 'EPERM', 'EROFS', 'ENOENT', 'ENOTDIR']);

function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | undefined)?.code;
}

export function classifyStorageFailure(error: unknown): StorageFailureKind {
  if (error instanceof GoogleAuthRevokedError) {
    return 'needs-attention';
  }
  if (error instanceof GoogleApiError) {
    if (error.reason === 'storageQuotaExceeded') {
      return 'out-of-space';
    }
    if (
      error.status === 429 ||
      (error.status === 403 && RATE_LIMIT_REASONS.has(error.reason ?? ''))
    ) {
      return 'rate-limited';
    }
    if (ATTENTION_REASONS.has(error.reason ?? '')) {
      return 'needs-attention';
    }
    return 'transient';
  }
  const code = errorCode(error instanceof StorageAccessError ? error.cause : error);
  if (code === 'ENOSPC') {
    return 'out-of-space';
  }
  if (error instanceof StorageAccessError && ATTENTION_CODES.has(code ?? '')) {
    return 'needs-attention';
  }
  return 'transient';
}
