import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buffer, text } from 'node:stream/consumers';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  DRIVE_FOLDER_MIME_TYPE,
  GoogleAccessTokens,
  GoogleApiError,
  GoogleAuthRevokedError,
  GoogleDriveApi,
  GoogleDriveStorageDriver,
  GoogleOAuthClient,
  StorageIntegrityError,
  StorageNotFoundError,
  classifyStorageFailure,
  ensureTopFolder,
} from '../src/index.js';
import { FakeGoogle } from '../src/testing/index.js';

const TOP = 'Unofficial Telegram Archive';

/** A PUT that carries bytes of a resumable upload (not a "how much do you have" query). */
function isDataChunk(input: string | URL | Request, init?: RequestInit): boolean {
  const range = (init?.headers as Record<string, string> | undefined)?.['content-range'] ?? '';
  return String(input).includes('upload_id=') && init?.method === 'PUT' && /^bytes \d+-/.test(range);
}
const KEY = 'Physics (-100123)/2026-09/7 - notes.pdf';

describe('GoogleDriveStorageDriver', () => {
  let google: FakeGoogle;
  let base: string;
  let drive: GoogleDriveApi;
  let driver: GoogleDriveStorageDriver;
  let rootId: string;
  let fetchFn: typeof fetch;

  beforeAll(async () => {
    google = await FakeGoogle.start();
    base = await mkdtemp(path.join(tmpdir(), 'tam-drive-'));
  });

  afterAll(async () => {
    await google.close();
    await rm(base, { recursive: true, force: true });
  });

  beforeEach(async () => {
    google.files.clear();
    google.requests.length = 0;
    fetchFn = fetch;
    const oauth = new GoogleOAuthClient(
      { clientId: google.clientId, clientSecret: google.clientSecret },
      google.endpoints,
    );
    drive = new GoogleDriveApi(new GoogleAccessTokens(oauth, google.issueRefreshToken()), {
      endpoints: google.endpoints,
      fetch: (input, init) => fetchFn(input, init),
      sleep: () => Promise.resolve(),
      chunkBytes: 256 * 1024,
      multipartMaxBytes: 300 * 1024,
    });
    rootId = (await ensureTopFolder(drive, TOP)).id;
    driver = new GoogleDriveStorageDriver(drive, rootId);
  });

  afterEach(() => {
    fetchFn = fetch;
  });

  async function source(content: Buffer | string): Promise<string> {
    const file = path.join(base, `${randomBytes(6).toString('hex')}.part`);
    await writeFile(file, content);
    return file;
  }

  const folderCount = (parentId: string, name: string) =>
    google.childrenOf(parentId).filter((file) => file.name === name && file.mimeType === DRIVE_FOLDER_MIME_TYPE).length;

  it('creates the top folder once and reuses it', async () => {
    expect((await ensureTopFolder(drive, TOP)).id).toBe(rootId);
    expect(folderCount('root', TOP)).toBe(1);
  });

  it('uploads a small file into readable nested folders and reads it back', async () => {
    const info = await driver.putFile(KEY, await source('lecture notes'), { contentType: 'application/pdf' });
    expect(info).toEqual({ key: KEY, size: 13, contentType: 'application/pdf' });

    const stored = google.fileAt(TOP, 'Physics (-100123)', '2026-09', '7 - notes.pdf');
    expect(stored?.content.toString()).toBe('lecture notes');
    expect(await driver.stat(KEY)).toMatchObject({ key: KEY, size: 13, contentType: 'application/pdf' });
    expect(await text(await driver.openReadStream(KEY))).toBe('lecture notes');
    expect(await text(await driver.openReadStream(KEY, { start: 8, end: 12 }))).toBe('notes');
    expect(driver.localPath()).toBeNull();
  });

  it('replaces the content of an existing file instead of adding a second one', async () => {
    await driver.putFile(KEY, await source('first'));
    await driver.putFile(KEY, await source('second version'));
    const month = google.fileAt(TOP, 'Physics (-100123)', '2026-09');
    expect(google.childrenOf(month?.id as string)).toHaveLength(1);
    expect(await text(await driver.openReadStream(KEY))).toBe('second version');
  });

  it('uploads large files in chunks and resumes after failed chunks', async () => {
    const content = randomBytes(1024 * 1024 + 123);
    google.failNextChunks(2);
    const info = await driver.putFile(KEY, await source(content), { contentType: 'video/mp4' });

    expect(info.size).toBe(content.length);
    expect(google.fileAt(TOP, 'Physics (-100123)', '2026-09', '7 - notes.pdf')?.content.equals(content)).toBe(true);
    expect(google.requests.filter((request) => request.method === 'PUT').length).toBeGreaterThan(5);
    expect((await buffer(await driver.openReadStream(KEY))).equals(content)).toBe(true);
  });

  it('verifies the checksum Google computed', async () => {
    await expect(
      driver.putFile(KEY, await source('content'), { sha256: 'f'.repeat(64) }),
    ).rejects.toBeInstanceOf(StorageIntegrityError);
  });

  it('creates each folder once when uploads run in parallel', async () => {
    await Promise.all(
      Array.from({ length: 6 }, async (_, index) =>
        driver.putFile(`Physics (-100123)/2026-09/${index} - file.bin`, await source(`file ${index}`)),
      ),
    );
    expect(folderCount(rootId, 'Physics (-100123)')).toBe(1);
    const channel = google.fileAt(TOP, 'Physics (-100123)');
    expect(folderCount(channel?.id as string, '2026-09')).toBe(1);
  });

  it('duplicates with a Drive copy and deletes', async () => {
    await driver.putFile(KEY, await source('shared bytes'));
    const copy = 'Chemistry (-100456)/2026-09/3 - notes.pdf';
    await driver.duplicate(KEY, copy);
    expect(await text(await driver.openReadStream(copy))).toBe('shared bytes');

    await driver.delete(KEY);
    expect(await driver.stat(KEY)).toBeNull();
    await driver.delete(KEY);
    await expect(driver.openReadStream(KEY)).rejects.toBeInstanceOf(StorageNotFoundError);
    await expect(driver.duplicate(KEY, copy)).rejects.toBeInstanceOf(StorageNotFoundError);
    expect(await driver.stat('Nowhere (-1)/2026-01/1.jpg')).toBeNull();
  });

  it('probes without leaving files behind, and notices a deleted top folder', async () => {
    await driver.probe();
    expect(google.childrenOf(rootId)).toEqual([]);

    google.files.delete(rootId);
    await expect(driver.probe()).rejects.toThrow(/no longer in Google Drive/);
  });

  it('reports the storage quota', async () => {
    google.quota = { limit: 15 * 1024 ** 3, usage: 5 * 1024 ** 3 };
    expect(await driver.space()).toEqual({
      totalBytes: 15 * 1024 ** 3,
      usedBytes: 5 * 1024 ** 3,
      freeBytes: 10 * 1024 ** 3,
    });
    google.quota = { limit: null, usage: 123 };
    expect(await driver.space()).toEqual({ totalBytes: null, usedBytes: 123, freeBytes: null });
  });

  it('refreshes an expired access token transparently', async () => {
    await driver.putFile(KEY, await source('x'));
    google.expireAccessTokens();
    expect(await driver.stat(KEY)).toMatchObject({ size: 1 });
  });

  it('retries rate limits and reports a revoked grant', async () => {
    let limited = 1;
    fetchFn = async (input, init) => {
      if (limited > 0 && String(input).includes('/drive/v3/about')) {
        limited -= 1;
        return Response.json(
          { error: { code: 403, message: 'Rate limit', errors: [{ reason: 'userRateLimitExceeded' }] } },
          { status: 403 },
        );
      }
      return fetch(input, init);
    };
    await expect(driver.space()).resolves.toMatchObject({ usedBytes: expect.any(Number) });

    google.revokeAll();
    await expect(driver.space()).rejects.toBeInstanceOf(GoogleAuthRevokedError);
  });

  it('explains a full Drive', async () => {
    fetchFn = async (input, init) =>
      String(input).includes('uploadType=multipart')
        ? Response.json(
            { error: { code: 403, message: 'The user has exceeded their Drive storage quota', errors: [{ reason: 'storageQuotaExceeded' }] } },
            { status: 403 },
          )
        : fetch(input, init);
    await expect(driver.putFile(KEY, await source('x'))).rejects.toThrow('Google Drive is full.');
  });

  it('refreshes the access token when Google rejects a chunk', async () => {
    const content = randomBytes(700 * 1024);
    let rejected = 0;
    fetchFn = async (input, init) => {
      if (rejected === 0 && isDataChunk(input, init)) {
        rejected += 1;
        google.expireAccessTokens();
        return new Response(null, { status: 401 });
      }
      return fetch(input, init);
    };
    await driver.putFile(KEY, await source(content));
    expect(rejected).toBe(1);
    expect(google.fileAt(TOP, 'Physics (-100123)', '2026-09', '7 - notes.pdf')?.content.equals(content)).toBe(true);
  });

  it('waits as long as Google asks when chunks are rate limited, and keeps the reason', async () => {
    const waits: number[] = [];
    const oauth = new GoogleOAuthClient(
      { clientId: google.clientId, clientSecret: google.clientSecret },
      google.endpoints,
    );
    const api = new GoogleDriveApi(new GoogleAccessTokens(oauth, google.issueRefreshToken()), {
      endpoints: google.endpoints,
      fetch: (input, init) => fetchFn(input, init),
      sleep: (milliseconds) => {
        waits.push(milliseconds);
        return Promise.resolve();
      },
      chunkBytes: 256 * 1024,
      multipartMaxBytes: 300 * 1024,
      maxAttempts: 3,
    });
    const limitedDriver = new GoogleDriveStorageDriver(api, rootId);
    let limited = 2;
    fetchFn = async (input, init) => {
      if (limited > 0 && isDataChunk(input, init)) {
        limited -= 1;
        return Response.json(
          { error: { code: 403, message: 'User rate limit exceeded.', errors: [{ reason: 'userRateLimitExceeded' }] } },
          { status: 403, headers: { 'retry-after': '7' } },
        );
      }
      return fetch(input, init);
    };
    const content = randomBytes(600 * 1024);
    await limitedDriver.putFile(KEY, await source(content));
    expect(waits).toEqual([7_000, 7_000]);
    expect(google.fileAt(TOP, 'Physics (-100123)', '2026-09', '7 - notes.pdf')?.content.equals(content)).toBe(true);

    limited = Number.POSITIVE_INFINITY;
    const failure = await limitedDriver.putFile(KEY, await source(content)).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(GoogleApiError);
    expect(failure).toMatchObject({ status: 403, reason: 'userRateLimitExceeded' });
    expect(classifyStorageFailure(failure)).toBe('rate-limited');
  });

  it('reports a grant revoked in the middle of an upload', async () => {
    let revoked = false;
    fetchFn = async (input, init) => {
      if (!revoked && isDataChunk(input, init)) {
        revoked = true;
        google.revokeAll();
      }
      return fetch(input, init);
    };
    await expect(driver.putFile(KEY, await source(randomBytes(700 * 1024)))).rejects.toBeInstanceOf(
      GoogleAuthRevokedError,
    );
  });

  it('reports upload progress and stops when asked', async () => {
    const content = randomBytes(1024 * 1024);
    const progress: number[] = [];
    await driver.putFile(KEY, await source(content), { onProgress: (bytes) => progress.push(bytes) });
    expect(progress.length).toBeGreaterThan(2);
    expect(progress.at(-1)).toBe(content.length);
    expect(progress).toEqual([...progress].sort((a, b) => a - b));

    const other = 'Physics (-100123)/2026-09/8 - more.pdf';
    const controller = new AbortController();
    await expect(
      driver.putFile(other, await source(content), {
        signal: controller.signal,
        onProgress: (bytes) => {
          if (bytes > 0) {
            controller.abort();
          }
        },
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(await driver.stat(other)).toBeNull();
  });

  it('tells the checksum Google computed and stages nothing itself', async () => {
    const content = Buffer.from('checked bytes');
    await driver.putFile(KEY, await source(content));
    expect(await driver.stat(KEY)).toMatchObject({
      size: content.length,
      sha256: createHash('sha256').update(content).digest('hex'),
    });
    expect(driver.stagingDir()).toBeNull();
  });
});
