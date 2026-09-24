import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  LocalFolderPolicy,
  LocalPathNotAllowedError,
  StorageNotFoundError,
  isInsideFolder,
} from '../src/index.js';

describe('LocalFolderPolicy', () => {
  let base: string;
  let allowed: string;
  let outside: string;

  beforeAll(async () => {
    base = await mkdtemp(path.join(tmpdir(), 'tam-policy-'));
    allowed = path.join(base, 'allowed');
    outside = path.join(base, 'outside');
    await mkdir(path.join(allowed, 'Lessons', 'Physics'), { recursive: true });
    await mkdir(path.join(allowed, '2 Maths'), { recursive: true });
    await mkdir(path.join(allowed, '10 Chemistry'), { recursive: true });
    await mkdir(path.join(allowed, '.hidden'), { recursive: true });
    await mkdir(path.join(allowed, '$RECYCLE.BIN'), { recursive: true });
    await mkdir(outside, { recursive: true });
    // A junction (Windows) / symlink (elsewhere) inside the allowed folder that leads outside.
    await symlink(outside, path.join(allowed, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
  });

  afterAll(async () => {
    await rm(base, { recursive: true, force: true });
  });

  it('tells whether a folder lies inside another', () => {
    expect(isInsideFolder(path.join(allowed, 'a'), allowed)).toBe(true);
    expect(isInsideFolder(allowed, allowed)).toBe(true);
    expect(isInsideFolder(outside, allowed)).toBe(false);
    expect(isInsideFolder(`${allowed}-sibling`, allowed)).toBe(false);
    expect(isInsideFolder(path.join(allowed, '..foo'), allowed)).toBe(true);
  });

  it('accepts folders inside an allowed root, existing or not', async () => {
    const policy = new LocalFolderPolicy([allowed]);
    await expect(policy.resolve(path.join(allowed, 'Lessons'))).resolves.toBe(path.join(allowed, 'Lessons'));
    await expect(policy.resolve(`  ${path.join(allowed, 'New', 'Deep')}  `)).resolves.toBe(
      path.join(allowed, 'New', 'Deep'),
    );
    await expect(policy.resolve(allowed)).resolves.toBe(allowed);
  });

  it('refuses folders outside the roots, relative paths, traversal and links that lead out', async () => {
    const policy = new LocalFolderPolicy([allowed]);
    for (const input of [
      outside,
      'relative/folder',
      path.join(allowed, '..', 'outside'),
      path.join(allowed, 'escape'),
      path.join(allowed, 'escape', 'below'),
    ]) {
      await expect(policy.resolve(input), input).rejects.toBeInstanceOf(LocalPathNotAllowedError);
    }
    await expect(new LocalFolderPolicy([]).resolve(allowed)).rejects.toThrow(/STORAGE_LOCAL_ROOTS/);
  });

  it('lists the roots, then subfolders in natural order without hidden or system ones', async () => {
    const policy = new LocalFolderPolicy([allowed]);
    const roots = await policy.list();
    expect(roots).toMatchObject({ path: null, parent: null, folders: [{ name: allowed, path: allowed }] });

    const top = await policy.list(allowed);
    expect(top.parent).toBeNull();
    expect(top.folders.map((folder) => folder.name)).toEqual(['2 Maths', '10 Chemistry', 'Lessons']);
    expect(top.truncated).toBe(false);

    const lessons = await policy.list(path.join(allowed, 'Lessons'));
    expect(lessons.parent).toBe(allowed);
    expect(lessons.folders).toEqual([{ name: 'Physics', path: path.join(allowed, 'Lessons', 'Physics') }]);

    await expect(policy.list(path.join(allowed, 'missing'))).rejects.toBeInstanceOf(StorageNotFoundError);
    await expect(policy.list(outside)).rejects.toBeInstanceOf(LocalPathNotAllowedError);
  });

  it('identifies folders case-insensitively on Windows only', () => {
    const upper = LocalFolderPolicy.identity(path.join(allowed, 'Lessons'));
    const lower = LocalFolderPolicy.identity(path.join(allowed, 'lessons'));
    expect(upper === lower).toBe(process.platform === 'win32');
    expect(() => new LocalFolderPolicy(['relative'])).toThrow(/absolute/);
  });
});
