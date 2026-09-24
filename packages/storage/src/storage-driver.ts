import type { Readable } from 'node:stream';

/** Mirrors the StorageKind enum of the database. */
export type StorageKind = 'LOCAL' | 'GOOGLE_DRIVE';

export interface StoredObjectInfo {
  key: string;
  size: number;
  contentType: string | null;
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
  /** Null when the object does not exist. */
  stat(key: string): Promise<StoredObjectInfo | null>;
  /** Streams the object, optionally a byte range (for HTTP 206 responses). */
  openReadStream(key: string, range?: ByteRange): Promise<Readable>;
  delete(key: string): Promise<void>;
  /** Absolute filesystem path for local storage (lets the api use sendFile); null otherwise. */
  localPath(key: string): string | null;
  /** Writes, reads back and removes a small file: proves the location is usable right now. */
  probe(): Promise<void>;
  space(): Promise<StorageSpace>;
}
