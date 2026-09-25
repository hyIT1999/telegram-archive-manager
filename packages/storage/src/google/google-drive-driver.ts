import { randomUUID } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import { StorageIntegrityError, StorageNotFoundError } from '../errors.js';
import { splitKey } from '../paths.js';
import type {
  ByteRange,
  PutOptions,
  StorageDriver,
  StorageSpace,
  StoredObjectInfo,
} from '../storage-driver.js';
import { type DriveFile, type GoogleDriveApi } from './google-drive-api.js';
import { GoogleApiError } from './google-oauth.js';

const DEFAULT_CONTENT_TYPE = 'application/octet-stream';

/** The app's own top folder in My Drive: reused if this app created it before, else created. */
export async function ensureTopFolder(drive: GoogleDriveApi, name: string): Promise<DriveFile> {
  return (await drive.findChild('root', name, 'folder')) ?? (await drive.createFolder('root', name));
}

/**
 * A folder in the user's Google Drive. Keys map to nested folders by name, created on demand
 * (one creation per path at a time, so concurrent uploads never make duplicate folders).
 * With the drive.file scope the app only ever sees what it created itself.
 */
export class GoogleDriveStorageDriver implements StorageDriver {
  readonly kind = 'GOOGLE_DRIVE' as const;
  private readonly folderIds = new Map<string, string>();
  private readonly creating = new Map<string, Promise<string>>();

  constructor(
    private readonly drive: GoogleDriveApi,
    private readonly rootFolderId: string,
  ) {}

  localPath(): null {
    return null;
  }

  /** Drive files are uploaded from wherever the caller staged them. */
  stagingDir(): null {
    return null;
  }

  async putFile(key: string, sourcePath: string, options: PutOptions = {}): Promise<StoredObjectInfo> {
    const { size } = await stat(sourcePath);
    let file: DriveFile;
    try {
      file = await this.upload(key, sourcePath, size, options);
    } catch (error) {
      // A cached folder was deleted in Drive meanwhile: find or create the folders again.
      if (!(error instanceof GoogleApiError) || error.status !== 404) {
        throw error;
      }
      this.folderIds.clear();
      file = await this.upload(key, sourcePath, size, options);
    }
    const storedSize = file.size === undefined ? size : Number(file.size);
    if (storedSize !== size) {
      throw new StorageIntegrityError(`Google Drive stored ${storedSize} of ${size} bytes of ${key}`);
    }
    if (options.sha256 && file.sha256Checksum && file.sha256Checksum.toLowerCase() !== options.sha256.toLowerCase()) {
      throw new StorageIntegrityError(`The checksum of ${key} in Google Drive does not match`);
    }
    return { key, size, contentType: file.mimeType || options.contentType || null };
  }

  async duplicate(sourceKey: string, targetKey: string): Promise<void> {
    const source = await this.find(sourceKey);
    if (!source) {
      throw new StorageNotFoundError(`${sourceKey} does not exist`);
    }
    const { folders, name } = this.split(targetKey);
    const parentId = await this.folder(folders);
    const existing = await this.drive.findChild(parentId, name, 'file');
    if (existing) {
      await this.drive.deleteFile(existing.id);
    }
    await this.drive.copyFile(source.id, parentId, name);
  }

  async stat(key: string): Promise<StoredObjectInfo | null> {
    const file = await this.find(key);
    return file
      ? { key, size: Number(file.size ?? 0), contentType: file.mimeType || null, sha256: file.sha256Checksum ?? null }
      : null;
  }

  async openReadStream(key: string, range?: ByteRange): Promise<Readable> {
    const file = await this.find(key);
    if (!file) {
      throw new StorageNotFoundError(`${key} does not exist`);
    }
    const response = await this.drive.download(file.id, range);
    return Readable.fromWeb(response.body as unknown as WebReadableStream<Uint8Array>);
  }

  async delete(key: string): Promise<void> {
    const file = await this.find(key);
    if (file) {
      await this.drive.deleteFile(file.id);
    }
  }

  async probe(): Promise<void> {
    const root = await this.drive.getFile(this.rootFolderId);
    if (!root || root.trashed) {
      throw new StorageNotFoundError(
        'The archive folder is no longer in Google Drive (deleted or in the trash). Reconnect the account.',
      );
    }
    const content = Buffer.from(
      `Unofficial Telegram Archive Manager write check ${new Date().toISOString()}`,
    );
    const file = await this.drive.uploadBytes(
      { parentId: this.rootFolderId, name: `.tam-probe-${randomUUID()}.txt` },
      content,
      'text/plain',
    );
    try {
      const response = await this.drive.download(file.id);
      if (!Buffer.from(await response.arrayBuffer()).equals(content)) {
        throw new StorageIntegrityError('Google Drive returned different content than was written');
      }
    } finally {
      await this.drive.deleteFile(file.id);
    }
  }

  async space(): Promise<StorageSpace> {
    const { limit, usage } = await this.drive.storageQuota();
    return {
      totalBytes: limit,
      usedBytes: usage,
      freeBytes: limit === null ? null : Math.max(0, limit - (usage ?? 0)),
    };
  }

  private async upload(key: string, sourcePath: string, size: number, options: PutOptions): Promise<DriveFile> {
    const { folders, name } = this.split(key);
    const parentId = await this.folder(folders);
    const existing = await this.drive.findChild(parentId, name, 'file');
    return this.drive.upload(
      existing ? { fileId: existing.id } : { parentId, name },
      { path: sourcePath, size, contentType: options.contentType ?? DEFAULT_CONTENT_TYPE },
      {
        ...(options.signal ? { signal: options.signal } : {}),
        ...(options.onProgress ? { onProgress: options.onProgress } : {}),
      },
    );
  }

  private split(key: string): { folders: string[]; name: string } {
    const segments = splitKey(key);
    return { folders: segments.slice(0, -1), name: segments.at(-1) as string };
  }

  private async find(key: string): Promise<DriveFile | null> {
    const { folders, name } = this.split(key);
    const parentId = await this.existingFolder(folders);
    return parentId === null ? null : this.drive.findChild(parentId, name, 'file');
  }

  /** The folder at `segments` below the root, created where missing. */
  private async folder(segments: readonly string[]): Promise<string> {
    let parentId = this.rootFolderId;
    for (let index = 0; index < segments.length; index += 1) {
      const path = segments.slice(0, index + 1).join('/');
      parentId = this.folderIds.get(path) ?? (await this.createOnce(path, parentId, segments[index] as string));
    }
    return parentId;
  }

  /** Like folder(), but never creates anything; null when a folder is missing. */
  private async existingFolder(segments: readonly string[]): Promise<string | null> {
    let parentId = this.rootFolderId;
    for (let index = 0; index < segments.length; index += 1) {
      const path = segments.slice(0, index + 1).join('/');
      const cached = this.folderIds.get(path);
      if (cached) {
        parentId = cached;
        continue;
      }
      const found = await this.drive.findChild(parentId, segments[index] as string, 'folder');
      if (!found) {
        return null;
      }
      this.folderIds.set(path, found.id);
      parentId = found.id;
    }
    return parentId;
  }

  private createOnce(path: string, parentId: string, name: string): Promise<string> {
    let pending = this.creating.get(path);
    if (!pending) {
      pending = (async () => {
        const folder =
          (await this.drive.findChild(parentId, name, 'folder')) ??
          (await this.drive.createFolder(parentId, name));
        this.folderIds.set(path, folder.id);
        return folder.id;
      })().finally(() => this.creating.delete(path));
      this.creating.set(path, pending);
    }
    return pending;
  }
}
