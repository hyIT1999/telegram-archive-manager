import { randomUUID } from 'node:crypto';
import { open } from 'node:fs/promises';
import { StorageAccessError, StorageNotFoundError } from '../errors.js';
import type { ByteRange } from '../storage-driver.js';
import {
  type AccessTokenSource,
  GOOGLE_ENDPOINTS,
  GoogleApiError,
  type GoogleEndpoints,
} from './google-oauth.js';

export const DRIVE_FOLDER_MIME_TYPE = 'application/vnd.google-apps.folder';
/** Chunks of resumable uploads must be multiples of 256 KiB (except the last one). */
export const UPLOAD_CHUNK_BYTES = 8 * 1024 * 1024;
/** Files up to this size go in one multipart request. */
export const MULTIPART_MAX_BYTES = 5 * 1024 * 1024;

const FILE_FIELDS = 'id,name,mimeType,size,sha256Checksum,trashed';
const METADATA_TIMEOUT_MS = 60_000;
const TRANSFER_TIMEOUT_MS = 10 * 60_000;
const RATE_LIMIT_REASONS = new Set(['rateLimitExceeded', 'userRateLimitExceeded']);

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  /** Bytes, as a decimal string (absent for folders). */
  size?: string;
  sha256Checksum?: string;
  trashed?: boolean;
}

/** Where an upload goes: a new file in a folder, or new content for an existing file. */
export type UploadTarget = { parentId: string; name: string } | { fileId: string };

export interface UploadSource {
  path: string;
  size: number;
  contentType: string;
}

/** Controls of a long upload. */
export interface UploadOptions {
  /** Stops the upload (the request in flight is aborted; Drive keeps what it had). */
  signal?: AbortSignal;
  /** Bytes Google has stored so far. */
  onProgress?: (uploadedBytes: number) => void;
}

export interface GoogleDriveApiOptions {
  endpoints?: GoogleEndpoints;
  fetch?: typeof fetch;
  /** Waits between retries; tests pass one that does not wait. */
  sleep?: (milliseconds: number) => Promise<void>;
  /** Bytes per resumable upload request (a multiple of 256 KiB). */
  chunkBytes?: number;
  /** Attempts per request before giving up (network errors, 429, 5xx). */
  maxAttempts?: number;
  /** Files up to this size are uploaded in one request. */
  multipartMaxBytes?: number;
}

type SessionStatus =
  | { kind: 'incomplete'; received: number }
  | { kind: 'complete'; file: DriveFile }
  | { kind: 'expired' }
  | { kind: 'unknown' };

const wait = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

/** Exponential backoff with jitter: ~1 s, 2 s, 4 s, … capped at 32 s. */
function backoff(attempt: number): number {
  return Math.min(32_000, 1_000 * 2 ** (attempt - 1)) + Math.floor(Math.random() * 500);
}

/** The wait Google asks for (Retry-After, in seconds), if any. */
function retryAfterMs(response: Response): number | null {
  const seconds = Number(response.headers.get('retry-after'));
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : null;
}

/** A request's signal: its timeout (if any), cut short by the caller's signal (if any). */
function requestSignal(timeoutMs: number | null, signal: AbortSignal | undefined): AbortSignal | null {
  const signals: AbortSignal[] = [];
  if (timeoutMs !== null) {
    signals.push(AbortSignal.timeout(timeoutMs));
  }
  if (signal) {
    signals.push(signal);
  }
  if (signals.length === 0) {
    return null;
  }
  return signals.length === 1 ? (signals[0] as AbortSignal) : AbortSignal.any(signals);
}

/** Drive query strings quote with ' and escape \ and '. */
function quote(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

/** "bytes=0-42" → 43 bytes received; no header → nothing received yet. */
function receivedBytes(range: string | null): number {
  const match = range === null ? null : /^bytes=0-(\d+)$/.exec(range.trim());
  return match ? Number(match[1]) + 1 : 0;
}

/**
 * The part of the Drive v3 REST API the archive needs, over fetch. Retries rate limits and
 * server errors with backoff, refreshes the access token once on 401, and resumes interrupted
 * uploads from the bytes Google already has.
 */
export class GoogleDriveApi {
  private readonly endpoints: GoogleEndpoints;
  private readonly fetchFn: typeof fetch;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly chunkBytes: number;
  private readonly maxAttempts: number;
  private readonly multipartMaxBytes: number;

  constructor(
    private readonly tokens: AccessTokenSource,
    options: GoogleDriveApiOptions = {},
  ) {
    this.endpoints = options.endpoints ?? GOOGLE_ENDPOINTS;
    this.fetchFn = options.fetch ?? fetch;
    this.sleep = options.sleep ?? wait;
    this.chunkBytes = options.chunkBytes ?? UPLOAD_CHUNK_BYTES;
    this.maxAttempts = options.maxAttempts ?? 6;
    this.multipartMaxBytes = options.multipartMaxBytes ?? MULTIPART_MAX_BYTES;
    if (this.chunkBytes % (256 * 1024) !== 0) {
      throw new Error('chunkBytes must be a multiple of 256 KiB');
    }
  }

  /** The first non-trashed child of `parentId` with this exact name ('root' = My Drive). */
  async findChild(parentId: string, name: string, kind: 'folder' | 'file'): Promise<DriveFile | null> {
    const q = [
      `${quote(parentId)} in parents`,
      `name = ${quote(name)}`,
      'trashed = false',
      `mimeType ${kind === 'folder' ? '=' : '!='} ${quote(DRIVE_FOLDER_MIME_TYPE)}`,
    ].join(' and ');
    const body = await this.json<{ files?: DriveFile[] }>(
      this.url('/drive/v3/files', { q, fields: `files(${FILE_FIELDS})`, pageSize: '10', spaces: 'drive' }),
      { method: 'GET' },
    );
    return body.files?.[0] ?? null;
  }

  createFolder(parentId: string, name: string): Promise<DriveFile> {
    return this.json<DriveFile>(this.url('/drive/v3/files', { fields: FILE_FIELDS }), {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=UTF-8' },
      body: JSON.stringify({ name, mimeType: DRIVE_FOLDER_MIME_TYPE, parents: [parentId] }),
    });
  }

  /** Null when the file does not exist (or this app may not see it). */
  async getFile(fileId: string): Promise<DriveFile | null> {
    const response = await this.send(
      this.url(`/drive/v3/files/${encodeURIComponent(fileId)}`, { fields: FILE_FIELDS }),
      { method: 'GET' },
    );
    if (response.status === 404) {
      await response.body?.cancel();
      return null;
    }
    return this.parse<DriveFile>(response);
  }

  /** The file's content (200), or a byte range of it (206). */
  async download(fileId: string, range?: ByteRange): Promise<Response> {
    const response = await this.send(
      this.url(`/drive/v3/files/${encodeURIComponent(fileId)}`, { alt: 'media' }),
      {
        method: 'GET',
        headers: range ? { range: `bytes=${range.start}-${range.end}` } : {},
      },
      // Streams may run for a long time (videos); undici still aborts a body that stalls.
      null,
    );
    if (response.status === 404) {
      await response.body?.cancel();
      throw new StorageNotFoundError('The file is no longer in Google Drive');
    }
    if (!response.ok || response.body === null) {
      throw await this.toError(response);
    }
    return response;
  }

  /** Deletes permanently; a file that is already gone is fine. */
  async deleteFile(fileId: string): Promise<void> {
    const response = await this.send(this.url(`/drive/v3/files/${encodeURIComponent(fileId)}`), {
      method: 'DELETE',
    });
    await response.body?.cancel();
    if (!response.ok && response.status !== 404) {
      throw await this.toError(response);
    }
  }

  copyFile(fileId: string, parentId: string, name: string): Promise<DriveFile> {
    return this.json<DriveFile>(
      this.url(`/drive/v3/files/${encodeURIComponent(fileId)}/copy`, { fields: FILE_FIELDS }),
      {
        method: 'POST',
        headers: { 'content-type': 'application/json; charset=UTF-8' },
        body: JSON.stringify({ name, parents: [parentId] }),
      },
    );
  }

  /** Bytes allowed and used across Drive, Gmail and Photos; limit is null for unlimited plans. */
  async storageQuota(): Promise<{ limit: number | null; usage: number | null }> {
    const body = await this.json<{ storageQuota?: { limit?: string; usage?: string } }>(
      this.url('/drive/v3/about', { fields: 'storageQuota(limit,usage)' }),
      { method: 'GET' },
    );
    const toNumber = (value: string | undefined) => (value === undefined ? null : Number(value));
    return { limit: toNumber(body.storageQuota?.limit), usage: toNumber(body.storageQuota?.usage) };
  }

  /** Uploads a local file: in one request when small, resumable in chunks otherwise. */
  async upload(target: UploadTarget, source: UploadSource, options: UploadOptions = {}): Promise<DriveFile> {
    if (source.size <= this.multipartMaxBytes) {
      const handle = await open(source.path, 'r');
      let data: Buffer;
      try {
        data = await handle.readFile();
      } finally {
        await handle.close();
      }
      const file = await this.uploadBytes(target, data, source.contentType, options.signal);
      options.onProgress?.(source.size);
      return file;
    }
    for (let session = 1; session <= 3; session += 1) {
      const sessionUri = await this.startSession(target, source, options.signal);
      const file = await this.sendChunks(sessionUri, source, options);
      if (file) {
        return file;
      }
      // The session expired (404/410): start over with a new one.
    }
    throw new GoogleApiError('Google Drive kept dropping the upload session. Try again later.', null, null);
  }

  /** Small content (≤ 5 MB) with its metadata in one multipart/related request. */
  uploadBytes(
    target: UploadTarget,
    data: Uint8Array,
    contentType: string,
    signal?: AbortSignal,
  ): Promise<DriveFile> {
    const boundary = `tam-${randomUUID()}`;
    const metadata = 'fileId' in target ? {} : { name: target.name, parents: [target.parentId] };
    const body = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
          `--${boundary}\r\nContent-Type: ${contentType}\r\n\r\n`,
      ),
      data,
      Buffer.from(`\r\n--${boundary}--`),
    ]);
    return this.json<DriveFile>(
      this.uploadUrl(target, 'multipart'),
      {
        method: 'fileId' in target ? 'PATCH' : 'POST',
        headers: { 'content-type': `multipart/related; boundary=${boundary}` },
        body,
      },
      TRANSFER_TIMEOUT_MS,
      signal,
    );
  }

  private uploadUrl(target: UploadTarget, uploadType: 'multipart' | 'resumable'): string {
    const path =
      'fileId' in target
        ? `/upload/drive/v3/files/${encodeURIComponent(target.fileId)}`
        : '/upload/drive/v3/files';
    return this.url(path, { uploadType, fields: FILE_FIELDS });
  }

  private async startSession(
    target: UploadTarget,
    source: UploadSource,
    signal: AbortSignal | undefined,
  ): Promise<string> {
    const response = await this.send(
      this.uploadUrl(target, 'resumable'),
      {
        method: 'fileId' in target ? 'PATCH' : 'POST',
        headers: {
          'content-type': 'application/json; charset=UTF-8',
          'x-upload-content-type': source.contentType,
          'x-upload-content-length': String(source.size),
        },
        body: JSON.stringify('fileId' in target ? {} : { name: target.name, parents: [target.parentId] }),
      },
      METADATA_TIMEOUT_MS,
      signal,
    );
    if (!response.ok) {
      throw await this.toError(response);
    }
    await response.body?.cancel();
    const sessionUri = response.headers.get('location');
    if (!sessionUri) {
      throw new GoogleApiError('Google Drive did not open an upload session', response.status, null);
    }
    return sessionUri;
  }

  /**
   * Sends the file from the first byte Google does not have yet; null when the session expired.
   * Network errors, 5xx, 429 and rate-limit 403s wait (as long as Retry-After asks, if it does),
   * then ask Google what it kept; a rejected access token is refreshed once in a row. After the
   * last try the error keeps Google's status and reason, so callers can tell a rate limit apart.
   */
  private async sendChunks(
    sessionUri: string,
    source: UploadSource,
    options: UploadOptions,
  ): Promise<DriveFile | null> {
    const { signal, onProgress } = options;
    const handle = await open(source.path, 'r');
    try {
      let offset = 0;
      let failures = 0;
      let askStatus = false;
      let refreshedToken = false;
      for (;;) {
        signal?.throwIfAborted();
        if (askStatus) {
          const status = await this.sessionStatus(sessionUri, source.size, signal);
          if (status.kind === 'complete') {
            onProgress?.(source.size);
            return status.file;
          }
          if (status.kind === 'expired') {
            return null;
          }
          if (status.kind === 'incomplete') {
            offset = status.received;
            askStatus = false;
          } else {
            failures += 1;
            if (failures >= this.maxAttempts) {
              throw new GoogleApiError('The upload to Google Drive keeps failing', null, null);
            }
            await this.pause(backoff(failures), signal);
            continue;
          }
        }
        const length = Math.min(this.chunkBytes, source.size - offset);
        const chunk = Buffer.alloc(length);
        let read = 0;
        while (read < length) {
          const { bytesRead } = await handle.read(chunk, read, length - read, offset + read);
          if (bytesRead === 0) {
            throw new StorageAccessError(`${source.path} changed while it was being uploaded`);
          }
          read += bytesRead;
        }
        // Outside the try below: a revoked grant must reach the caller as GoogleAuthRevokedError.
        const token = await this.tokens.get();
        const chunkSignal = requestSignal(TRANSFER_TIMEOUT_MS, signal);
        let response: Response | null;
        try {
          response = await this.fetchFn(sessionUri, {
            method: 'PUT',
            headers: {
              authorization: `Bearer ${token}`,
              'content-range': `bytes ${offset}-${offset + length - 1}/${source.size}`,
            },
            body: chunk,
            ...(chunkSignal ? { signal: chunkSignal } : {}),
          });
        } catch {
          signal?.throwIfAborted();
          response = null;
        }
        if (response?.status === 401 && !refreshedToken) {
          refreshedToken = true;
          await response.body?.cancel();
          this.tokens.invalidate();
          continue;
        }
        if (response === null || (await this.isRetryable(response))) {
          failures += 1;
          if (failures >= this.maxAttempts) {
            throw response === null
              ? new GoogleApiError('The upload to Google Drive keeps failing', null, null)
              : await this.toError(response);
          }
          const delay = (response === null ? null : retryAfterMs(response)) ?? backoff(failures);
          await response?.body?.cancel();
          await this.pause(delay, signal);
          askStatus = true;
          continue;
        }
        if (response.status === 200 || response.status === 201) {
          onProgress?.(source.size);
          return this.parse<DriveFile>(response);
        }
        if (response.status === 308) {
          await response.body?.cancel();
          offset = receivedBytes(response.headers.get('range'));
          failures = 0;
          refreshedToken = false;
          onProgress?.(offset);
          continue;
        }
        if (response.status === 404 || response.status === 410) {
          await response.body?.cancel();
          return null;
        }
        throw await this.toError(response);
      }
    } finally {
      await handle.close();
    }
  }

  private async sessionStatus(
    sessionUri: string,
    size: number,
    signal: AbortSignal | undefined,
  ): Promise<SessionStatus> {
    const token = await this.tokens.get();
    const statusSignal = requestSignal(METADATA_TIMEOUT_MS, signal);
    let response: Response;
    try {
      response = await this.fetchFn(sessionUri, {
        method: 'PUT',
        headers: {
          authorization: `Bearer ${token}`,
          'content-range': `bytes */${size}`,
        },
        ...(statusSignal ? { signal: statusSignal } : {}),
      });
    } catch {
      signal?.throwIfAborted();
      return { kind: 'unknown' };
    }
    if (response.status === 200 || response.status === 201) {
      return { kind: 'complete', file: await this.parse<DriveFile>(response) };
    }
    await response.body?.cancel();
    if (response.status === 308) {
      return { kind: 'incomplete', received: receivedBytes(response.headers.get('range')) };
    }
    if (response.status === 404 || response.status === 410) {
      return { kind: 'expired' };
    }
    if (response.status === 401) {
      this.tokens.invalidate();
    }
    return { kind: 'unknown' };
  }

  private url(path: string, query: Record<string, string> = {}): string {
    const url = new URL(path, this.endpoints.api);
    for (const [name, value] of Object.entries(query)) {
      url.searchParams.set(name, value);
    }
    return url.toString();
  }

  private async json<T>(
    url: string,
    init: RequestInit,
    timeoutMs = METADATA_TIMEOUT_MS,
    signal?: AbortSignal,
  ): Promise<T> {
    return this.parse<T>(await this.send(url, init, timeoutMs, signal));
  }

  private async parse<T>(response: Response): Promise<T> {
    if (!response.ok) {
      throw await this.toError(response);
    }
    return (await response.json()) as T;
  }

  /**
   * One request with the access token; retries network errors, 429, 5xx and rate-limit 403s.
   * `timeoutMs` bounds the whole exchange, body included; null leaves it unbounded. `signal`
   * aborts the request and any wait between tries.
   */
  private async send(
    url: string,
    init: RequestInit,
    timeoutMs: number | null = METADATA_TIMEOUT_MS,
    signal?: AbortSignal,
  ): Promise<Response> {
    let refreshedToken = false;
    for (let attempt = 1; ; attempt += 1) {
      const token = await this.tokens.get();
      const attemptSignal = requestSignal(timeoutMs, signal);
      let response: Response;
      try {
        response = await this.fetchFn(url, {
          ...init,
          headers: { ...(init.headers as Record<string, string>), authorization: `Bearer ${token}` },
          ...(attemptSignal ? { signal: attemptSignal } : {}),
        });
      } catch (error) {
        signal?.throwIfAborted();
        if (attempt >= this.maxAttempts) {
          throw new GoogleApiError('Cannot reach Google Drive. Check the internet connection of the server.', null, null, {
            cause: error,
          });
        }
        await this.pause(backoff(attempt), signal);
        continue;
      }
      if (response.status === 401 && !refreshedToken) {
        refreshedToken = true;
        await response.body?.cancel();
        this.tokens.invalidate();
        continue;
      }
      if (attempt < this.maxAttempts && (await this.isRetryable(response))) {
        await response.body?.cancel();
        await this.pause(retryAfterMs(response) ?? backoff(attempt), signal);
        continue;
      }
      return response;
    }
  }

  /** Waits between tries; an abort ends the wait at once. */
  private async pause(milliseconds: number, signal: AbortSignal | undefined): Promise<void> {
    if (!signal) {
      return this.sleep(milliseconds);
    }
    signal.throwIfAborted();
    let onAbort = (): void => undefined;
    const aborted = new Promise<never>((_resolve, reject) => {
      onAbort = () => reject(signal.reason instanceof Error ? signal.reason : new Error('Aborted'));
      signal.addEventListener('abort', onAbort, { once: true });
    });
    try {
      await Promise.race([this.sleep(milliseconds), aborted]);
    } finally {
      signal.removeEventListener('abort', onAbort);
    }
  }

  private async isRetryable(response: Response): Promise<boolean> {
    if (response.status === 429 || response.status >= 500) {
      return true;
    }
    if (response.status !== 403) {
      return false;
    }
    const reason = (await this.errorBody(response.clone())).reason;
    return reason !== null && RATE_LIMIT_REASONS.has(reason);
  }

  private async errorBody(response: Response): Promise<{ message: string | null; reason: string | null }> {
    try {
      const body = (await response.json()) as {
        error?: { message?: string; errors?: { reason?: string }[] };
      };
      return {
        message: body.error?.message ?? null,
        reason: body.error?.errors?.[0]?.reason ?? null,
      };
    } catch {
      return { message: null, reason: null };
    }
  }

  private async toError(response: Response): Promise<GoogleApiError> {
    const { message, reason } = await this.errorBody(response);
    switch (reason) {
      case 'storageQuotaExceeded':
        return new GoogleApiError('Google Drive is full.', response.status, reason);
      case 'insufficientFilePermissions':
      case 'appNotAuthorizedToFile':
        return new GoogleApiError(
          'This app can no longer use the Drive folder. Reconnect the Google account.',
          response.status,
          reason,
        );
      default:
        return new GoogleApiError(
          `Google Drive answered ${response.status}${message ? `: ${message}` : ''}`,
          response.status,
          reason,
        );
    }
  }
}
