import { mkdir, readdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { StorageAccessError, StorageError, StorageNotFoundError } from '../errors.js';

/** At most this many subfolders are listed at once. */
export const MAX_LISTED_FOLDERS = 500;

/** System folders that are never offered, whatever their case. */
const HIDDEN_FOLDERS = new Set(['system volume information', '$recycle.bin', 'lost+found']);

export interface LocalFolderEntry {
  name: string;
  path: string;
}

export interface LocalFolderListing {
  /** The listed folder; null for the list of allowed roots. */
  path: string | null;
  /** Where "up" leads; null at a root (back to the list of roots). */
  parent: string | null;
  folders: LocalFolderEntry[];
  /** More folders exist than were listed. */
  truncated: boolean;
}

/** The folder is outside the roots the server allows (STORAGE_LOCAL_ROOTS). */
export class LocalPathNotAllowedError extends StorageError {}

/** Whether `child` is `parent` or lies below it (case-insensitive on Windows, like the OS). */
export function isInsideFolder(child: string, parent: string): boolean {
  const relative = path.relative(parent, child);
  return (
    relative === '' ||
    (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`))
  );
}

function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | undefined)?.code;
}

async function deepestExisting(folder: string): Promise<string> {
  let candidate = folder;
  for (;;) {
    try {
      await stat(candidate);
      return candidate;
    } catch (error) {
      const parent = path.dirname(candidate);
      if (errorCode(error) !== 'ENOENT' || parent === candidate) {
        return candidate;
      }
      candidate = parent;
    }
  }
}

function compareNames(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

function isOffered(name: string): boolean {
  return !name.startsWith('.') && !name.startsWith('$') && !HIDDEN_FOLDERS.has(name.toLowerCase());
}

/**
 * Where local storage locations may live: only inside the roots the server configured. The web
 * can therefore never make the worker write into sensitive places (startup folders, system
 * directories), even with a stolen session. Symlinks and junctions are followed before checking.
 */
export class LocalFolderPolicy {
  readonly roots: readonly string[];

  constructor(roots: readonly string[]) {
    for (const root of roots) {
      if (!path.isAbsolute(root)) {
        throw new StorageError(`Storage roots must be absolute paths: ${root}`);
      }
    }
    this.roots = [...new Set(roots.map((root) => path.resolve(root)))];
  }

  /** Identity of a folder for "one location per folder" (case-insensitive on Windows). */
  static identity(folder: string): string {
    const resolved = path.resolve(folder);
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  }

  /** The normalized absolute folder, after checking it lies inside an allowed root. */
  async resolve(input: string): Promise<string> {
    if (this.roots.length === 0) {
      throw new LocalPathNotAllowedError(
        'No folders on this computer are allowed yet: set STORAGE_LOCAL_ROOTS on the server.',
      );
    }
    const trimmed = input.trim();
    if (!path.isAbsolute(trimmed)) {
      throw new LocalPathNotAllowedError('Enter a full folder path, starting from the drive or /.');
    }
    const folder = path.resolve(trimmed);
    const root = this.roots.find((candidate) => isInsideFolder(folder, candidate));
    if (root === undefined) {
      throw new LocalPathNotAllowedError(`Choose a folder inside ${this.roots.join(' or ')}.`);
    }
    await mkdir(root, { recursive: true }).catch(() => undefined);
    let realRoot: string;
    let realFolder: string;
    try {
      realRoot = await realpath(root);
      realFolder = await realpath(await deepestExisting(folder));
    } catch (error) {
      throw new StorageAccessError(`The folder ${root} cannot be opened.`, { cause: error });
    }
    if (!isInsideFolder(realFolder, realRoot)) {
      throw new LocalPathNotAllowedError('This folder links to a place outside the allowed folders.');
    }
    return folder;
  }

  /** The subfolders of `folder`, or the allowed roots when no folder is given. */
  async list(folder?: string): Promise<LocalFolderListing> {
    if (folder === undefined) {
      return {
        path: null,
        parent: null,
        folders: this.roots.map((root) => ({ name: root, path: root })),
        truncated: false,
      };
    }
    const current = await this.resolve(folder);
    let names: string[];
    try {
      const entries = await readdir(current, { withFileTypes: true });
      names = entries
        .filter((entry) => entry.isDirectory() && isOffered(entry.name))
        .map((entry) => entry.name)
        .sort(compareNames);
    } catch (error) {
      const code = errorCode(error);
      if (code === 'ENOENT' || code === 'ENOTDIR') {
        throw new StorageNotFoundError('This folder does not exist.', { cause: error });
      }
      throw new StorageAccessError('This folder cannot be read.', { cause: error });
    }
    const atRoot = this.roots.some((root) => path.relative(root, current) === '');
    return {
      path: current,
      parent: atRoot ? null : path.dirname(current),
      folders: names
        .slice(0, MAX_LISTED_FOLDERS)
        .map((name) => ({ name, path: path.join(current, name) })),
      truncated: names.length > MAX_LISTED_FOLDERS,
    };
  }
}
