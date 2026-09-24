import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { text } from 'node:stream/consumers';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LocalStorageDriver, StorageNotFoundError, UnsafeKeyError } from '../src/index.js';

describe('LocalStorageDriver', () => {
  let base: string;
  let root: string;
  let driver: LocalStorageDriver;

  beforeEach(async () => {
    base = await mkdtemp(path.join(tmpdir(), 'tam-local-'));
    root = path.join(base, 'archive');
    driver = new LocalStorageDriver(root);
  });

  afterEach(async () => {
    await rm(base, { recursive: true, force: true });
  });

  async function source(content: string): Promise<string> {
    const file = path.join(base, `${Math.random()}.part`);
    await writeFile(file, content);
    return file;
  }

  const key = 'Physics (-100123)/2026-09/7 - notes.pdf';

  it('stores a finished download under the readable key and reads it back', async () => {
    const file = await source('hello archive');
    const info = await driver.putFile(key, file, { contentType: 'application/pdf' });

    expect(info).toEqual({ key, size: 13, contentType: 'application/pdf' });
    expect(await readFile(path.join(root, 'Physics (-100123)', '2026-09', '7 - notes.pdf'), 'utf8')).toBe(
      'hello archive',
    );
    expect(driver.localPath(key)).toBe(path.join(root, 'Physics (-100123)', '2026-09', '7 - notes.pdf'));
    expect(await driver.stat(key)).toEqual({ key, size: 13, contentType: null });
    expect(await text(await driver.openReadStream(key))).toBe('hello archive');
    expect(await text(await driver.openReadStream(key, { start: 6, end: 12 }))).toBe('archive');
  });

  it('replaces an existing object', async () => {
    await driver.putFile(key, await source('first'));
    await driver.putFile(key, await source('second, longer'));
    expect(await text(await driver.openReadStream(key))).toBe('second, longer');
  });

  it('duplicates without downloading again, and deletes', async () => {
    await driver.putFile(key, await source('same bytes'));
    const copy = 'Other (-100456)/2026-09/9 - notes.pdf';
    await driver.duplicate(key, copy);
    expect(await text(await driver.openReadStream(copy))).toBe('same bytes');

    await driver.delete(key);
    expect(await driver.stat(key)).toBeNull();
    expect(await text(await driver.openReadStream(copy))).toBe('same bytes');
    await driver.delete(key);
    await expect(driver.duplicate(key, copy)).rejects.toBeInstanceOf(StorageNotFoundError);
    await expect(driver.openReadStream(key)).rejects.toBeInstanceOf(StorageNotFoundError);
  });

  it('never leaves the root', async () => {
    await expect(driver.putFile('../escape.txt', await source('x'))).rejects.toBeInstanceOf(UnsafeKeyError);
    expect(() => driver.localPath('a/../../b')).toThrow(UnsafeKeyError);
    expect(() => new LocalStorageDriver('relative/root')).toThrow(/absolute/);
  });

  it('probes by writing, reading and removing a file', async () => {
    await driver.probe();
    expect(await readdir(root)).toEqual([]);
    expect((await stat(root)).isDirectory()).toBe(true);
  });

  it('reports free and total space of the disk', async () => {
    const space = await driver.space();
    expect(space.totalBytes).toBeGreaterThan(0);
    expect(space.freeBytes).toBeGreaterThan(0);
    expect(space.freeBytes).toBeLessThanOrEqual(space.totalBytes as number);
  });

  it('explains when the folder cannot be used', async () => {
    const blocker = path.join(base, 'not-a-folder');
    await writeFile(blocker, 'file in the way');
    const broken = new LocalStorageDriver(path.join(blocker, 'archive'));
    await expect(broken.probe()).rejects.toThrow(/does not exist or is not a folder|Cannot use/);
  });
});
