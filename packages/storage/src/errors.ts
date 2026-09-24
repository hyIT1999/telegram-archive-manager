/** Base class of every storage failure; `message` can be shown to people as-is. */
export class StorageError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
  }
}

/** The object (or folder) does not exist in the storage location. */
export class StorageNotFoundError extends StorageError {}

/** The location cannot be written or read: permissions, a full disk, a removed folder… */
export class StorageAccessError extends StorageError {}

/** What the storage holds after a write differs from what was written (size or checksum). */
export class StorageIntegrityError extends StorageError {}

/** A key that could escape the location or is not a valid file name on every platform. */
export class UnsafeKeyError extends StorageError {
  constructor(key: string) {
    super(`Unsafe storage key: ${JSON.stringify(key)}`);
  }
}
