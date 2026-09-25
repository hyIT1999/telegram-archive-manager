import { describe, expect, it } from 'vitest';
import {
  GoogleApiError,
  GoogleAuthRevokedError,
  StorageAccessError,
  StorageIntegrityError,
  classifyStorageFailure,
} from '../src/index.js';

const errno = (code: string) => Object.assign(new Error(code), { code });

describe('classifyStorageFailure', () => {
  it('recognises a full disk or a full Drive', () => {
    expect(classifyStorageFailure(new StorageAccessError('full', { cause: errno('ENOSPC') }))).toBe(
      'out-of-space',
    );
    expect(classifyStorageFailure(errno('ENOSPC'))).toBe('out-of-space');
    expect(
      classifyStorageFailure(
        new GoogleApiError('Google Drive is full.', 403, 'storageQuotaExceeded'),
      ),
    ).toBe('out-of-space');
  });

  it('recognises Drive rate limits, the daily upload cap included', () => {
    expect(
      classifyStorageFailure(new GoogleApiError('limited', 403, 'userRateLimitExceeded')),
    ).toBe('rate-limited');
    expect(classifyStorageFailure(new GoogleApiError('limited', 403, 'rateLimitExceeded'))).toBe(
      'rate-limited',
    );
    expect(classifyStorageFailure(new GoogleApiError('slow down', 429, null))).toBe('rate-limited');
  });

  it('asks for a person when access is gone', () => {
    expect(classifyStorageFailure(new GoogleAuthRevokedError())).toBe('needs-attention');
    expect(
      classifyStorageFailure(new GoogleApiError('no access', 403, 'appNotAuthorizedToFile')),
    ).toBe('needs-attention');
    expect(
      classifyStorageFailure(new StorageAccessError('no permission', { cause: errno('EACCES') })),
    ).toBe('needs-attention');
    expect(classifyStorageFailure(new StorageAccessError('gone', { cause: errno('ENOENT') }))).toBe(
      'needs-attention',
    );
  });

  it('treats everything else as worth another try', () => {
    expect(
      classifyStorageFailure(new GoogleApiError('Cannot reach Google Drive.', null, null)),
    ).toBe('transient');
    expect(
      classifyStorageFailure(new GoogleApiError('Google Drive answered 503', 503, 'backendError')),
    ).toBe('transient');
    expect(classifyStorageFailure(new StorageIntegrityError('size differs'))).toBe('transient');
    expect(classifyStorageFailure(new StorageAccessError('file changed while uploading'))).toBe(
      'transient',
    );
    expect(classifyStorageFailure(new Error('boom'))).toBe('transient');
  });
});
