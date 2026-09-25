import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
  copyFile,
  link,
  mkdir,
  readFile,
  rename,
  rm,
  rmdir,
  stat,
  statfs,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import type { Readable } from 'node:stream';
import {
  StorageAccessError,
  StorageError,
  StorageIntegrityError,
  StorageNotFoundError,
} from '../errors.js';
import { splitKey } from '../paths.js';
import type {
  ByteRange,
  PutOptions,
  StorageDriver,
  StorageSpace,
  StoredObjectInfo,
} from '../storage-driver.js';
import { isInsideFolder } from './local-folder-policy.js';

const PROBE_FOLDER = '.tam-probe';
/** Unfinished downloads of this location (hidden in the folder browser, like every dot folder). */
export const STAGING_FOLDER = '.tam-tmp';

/** Windows briefly locks files that were just written (antivirus, indexing): try again soon. */
const RENAME_RETRY_CODES = new Set(['EBUSY', 'EPERM', 'EACCES']);
const RENAME_RETRY_DELAYS_MS = [50, 150, 400, 1_000];

const pause = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | undefined)?.code;
}

/** Turns filesystem errors into messages people can act on. */
function accessError(root: string, error: unknown): StorageError {
  switch (errorCode(error)) {
    case 'EACCES':
    case 'EPERM':
      return new StorageAccessError(`No permission to write to ${root}.`, { cause: error });
    case 'EROFS':
      return new StorageAccessError(`${root} is read-only.`, { cause: error });
    case 'ENOSPC':
      return new StorageAccessError(`The disk of ${root} is full.`, { cause: error });
    case 'ENOENT':
    case 'ENOTDIR':
      return new StorageAccessError(`${root} does not exist or is not a folder.`, { cause: error });
    default:
      return new StorageAccessError(`Cannot use ${root}: ${String((error as Error).message)}`, {
        cause: error,
      });
  }
}

/** A folder on the machine running the archive. Files keep the readable layout of paths.ts. */
export class LocalStorageDriver implements StorageDriver {
  readonly kind = 'LOCAL' as const;

  constructor(private readonly root: string) {
    if (!path.isAbsolute(root)) {
      throw new StorageError(`A local storage folder must be an absolute path: ${root}`);
    }
  }

  localPath(key: string): string {
    const target = path.join(this.root, ...splitKey(key));
    if (!isInsideFolder(target, this.root)) {
      throw new StorageError(`The key ${JSON.stringify(key)} leaves the storage folder`);
    }
    return target;
  }

  stagingDir(): string {
    return path.join(this.root, STAGING_FOLDER);
  }

  async putFile(key: string, sourcePath: string, options: PutOptions = {}): Promise<StoredObjectInfo> {
    const target = this.localPath(key);
    options.signal?.throwIfAborted();
    try {
      await mkdir(path.dirname(target), { recursive: true });
      try {
        await renameWithRetry(sourcePath, target);
      } catch (error) {
        if (errorCode(error) !== 'EXDEV') {
          throw error;
        }
        // Another volume: copy next to the target, then swap it in atomically.
        const temporary = `${target}.${randomUUID()}.tmp`;
        await copyFile(sourcePath, temporary);
        await rename(temporary, target);
        await rm(sourcePath, { force: true });
      }
      const info = await stat(target);
      return { key, size: info.size, contentType: options.contentType ?? null };
    } catch (error) {
      throw error instanceof StorageError ? error : accessError(this.root, error);
    }
  }

  async duplicate(sourceKey: string, targetKey: string): Promise<void> {
    const source = this.localPath(sourceKey);
    const target = this.localPath(targetKey);
    if (!(await this.stat(sourceKey))) {
      throw new StorageNotFoundError(`${sourceKey} does not exist`);
    }
    try {
      await mkdir(path.dirname(target), { recursive: true });
      await rm(target, { force: true });
      try {
        // Same bytes, no extra disk space.
        await link(source, target);
      } catch {
        await copyFile(source, target);
      }
    } catch (error) {
      throw accessError(this.root, error);
    }
  }

  async stat(key: string): Promise<StoredObjectInfo | null> {
    try {
      const info = await stat(this.localPath(key));
      return info.isFile() ? { key, size: info.size, contentType: null } : null;
    } catch (error) {
      if (errorCode(error) === 'ENOENT' || errorCode(error) === 'ENOTDIR') {
        return null;
      }
      throw accessError(this.root, error);
    }
  }

  async openReadStream(key: string, range?: ByteRange): Promise<Readable> {
    const info = await this.stat(key);
    if (!info) {
      throw new StorageNotFoundError(`${key} does not exist`);
    }
    if (range && (range.start < 0 || range.end < range.start || range.end >= info.size)) {
      throw new StorageError(`Invalid range ${range.start}-${range.end} for ${info.size} bytes`);
    }
    return createReadStream(this.localPath(key), range ? { start: range.start, end: range.end } : {});
  }

  async delete(key: string): Promise<void> {
    try {
      await rm(this.localPath(key), { force: true });
    } catch (error) {
      throw accessError(this.root, error);
    }
  }

  async probe(): Promise<void> {
    const folder = path.join(this.root, PROBE_FOLDER);
    const file = path.join(folder, `${randomUUID()}.txt`);
    const content = `Unofficial Telegram Archive Manager write check ${new Date().toISOString()}`;
    try {
      await mkdir(folder, { recursive: true });
      await writeFile(file, content, { flag: 'wx' });
      const readBack = await readFile(file, 'utf8');
      if (readBack !== content) {
        throw new StorageIntegrityError(`${this.root} returned different content than was written`);
      }
    } catch (error) {
      throw error instanceof StorageError ? error : accessError(this.root, error);
    } finally {
      await rm(file, { force: true }).catch(() => undefined);
      await rmdir(folder).catch(() => undefined);
    }
  }

  async space(): Promise<StorageSpace> {
    try {
      await mkdir(this.root, { recursive: true });
      const info = await statfs(this.root);
      return {
        freeBytes: info.bavail * info.bsize,
        totalBytes: info.blocks * info.bsize,
        usedBytes: (info.blocks - info.bfree) * info.bsize,
      };
    } catch (error) {
      throw accessError(this.root, error);
    }
  }
}

async function renameWithRetry(source: string, target: string): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rename(source, target);
      return;
    } catch (error) {
      const delay = RENAME_RETRY_DELAYS_MS[attempt];
      if (delay === undefined || !RENAME_RETRY_CODES.has(errorCode(error) ?? '')) {
        throw error;
      }
      await pause(delay);
    }
  }
}
