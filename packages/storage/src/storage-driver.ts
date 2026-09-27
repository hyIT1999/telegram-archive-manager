import type { Readable } from 'node:stream';

/** Mirrors the StorageKind enum of the database. */
export type StorageKind = 'LOCAL' | 'GOOGLE_DRIVE';

export interface StoredObjectInfo {
  key: string;
  size: number;
  contentType: string | null;
  /** SHA-256 (hex) when the backend computes one itself (Google Drive); absent otherwise. */
  sha256?: string | null;
  /** When the object last changed, where the backend says so cheaply (local files). */
  modifiedAt?: Date | null;
  /** The backend's own handle of the object (a Drive file id), so a read needs no second lookup. */
  ref?: string;
}

/** Inclusive byte range, as in an HTTP `Range: bytes=start-end` header. */
export interface ByteRange {
  start: number;
  end: number;
}

export interface PutOptions {
  contentType?: string;
  /** Expected SHA-256 (hex); drivers that learn the stored checksum compare it. */
  sha256?: string;
  /** Stops a long write (a Drive upload); what was stored before stays as it was. */
  signal?: AbortSignal;
  /** Bytes stored so far, for writes that take a while (Drive uploads). */
  onProgress?: (storedBytes: number) => void;
}

/** Space reported by the backend; null where it does not say (e.g. unlimited Drive plans). */
export interface StorageSpace {
  freeBytes: number | null;
  totalBytes: number | null;
  usedBytes: number | null;
}

/**
 * One storage location: a folder on the server or a folder in the user's Google Drive. Keys are
 * relative paths in the readable layout of paths.ts. Credentials never leave the server.
 */
export interface StorageDriver {
  readonly kind: StorageKind;
  /**
   * Stores a completed local file (e.g. a finished `.part` download) at `key`, replacing what is
   * there. The source may be moved away; callers delete it afterwards if it still exists.
   */
  putFile(key: string, sourcePath: string, options?: PutOptions): Promise<StoredObjectInfo>;
  /** Makes `targetKey` hold the same bytes as `sourceKey` without downloading them again. */
  duplicate(sourceKey: string, targetKey: string): Promise<void>;
  /** Null when the object does not exist (or, for a local folder, lies outside it). */
  stat(key: string): Promise<StoredObjectInfo | null>;
  /**
   * Streams the object, optionally a byte range (for HTTP 206 responses). `known` is what a
   * stat() of the same key just returned: the driver then does not look the object up again.
   */
  openReadStream(key: string, range?: ByteRange, known?: StoredObjectInfo): Promise<Readable>;
  delete(key: string): Promise<void>;
  /** Absolute filesystem path for local storage (lets the api use sendFile); null otherwise. */
  localPath(key: string): string | null;
  /**
   * Where unfinished downloads for this location wait: a hidden folder on the same volume, so
   * storing a finished file is a rename. Null when the location is not a local folder.
   */
  stagingDir(): string | null;
  /** Writes, reads back and removes a small file: proves the location is usable right now. */
  probe(): Promise<void>;
  space(): Promise<StorageSpace>;
}
