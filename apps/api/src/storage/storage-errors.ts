import {
  BadGatewayException,
  ConflictException,
  HttpException,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ApiErrorCode, StorageErrorCode } from '@tam/shared';
import {
  GoogleApiError,
  GoogleAuthRevokedError,
  LocalPathNotAllowedError,
  StorageError,
  StorageNotFoundError,
} from '@tam/storage';

/** The server lacks what a storage location needs (Google client, STORAGE_SECRET_KEY). */
export class StorageUnavailableError extends StorageError {}

/** Turns storage failures into API errors; anything else is rethrown untouched. */
export function toStorageHttpException(error: unknown): unknown {
  if (error instanceof HttpException || !(error instanceof StorageError)) {
    return error;
  }
  const body = (code: string) => ({ code, message: error.message });
  if (error instanceof LocalPathNotAllowedError) {
    return new UnprocessableEntityException(body(StorageErrorCode.PATH_NOT_ALLOWED));
  }
  if (error instanceof StorageNotFoundError) {
    return new NotFoundException(body(ApiErrorCode.NOT_FOUND));
  }
  if (error instanceof StorageUnavailableError) {
    return new ServiceUnavailableException(body(StorageErrorCode.GOOGLE_DRIVE_UNAVAILABLE));
  }
  if (error instanceof GoogleAuthRevokedError) {
    return new ConflictException(body(StorageErrorCode.GOOGLE_AUTH_REVOKED));
  }
  if (error instanceof GoogleApiError) {
    return new BadGatewayException(body(StorageErrorCode.GOOGLE_DRIVE_ERROR));
  }
  return new UnprocessableEntityException(body(StorageErrorCode.STORAGE_NOT_WRITABLE));
}

/** Runs `operation`, translating storage failures with toStorageHttpException. */
export async function withStorageErrors<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw toStorageHttpException(error);
  }
}
