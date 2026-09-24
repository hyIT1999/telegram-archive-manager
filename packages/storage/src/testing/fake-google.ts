import { createHash, randomBytes } from 'node:crypto';
import { type IncomingMessage, type Server, type ServerResponse, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { DRIVE_FOLDER_MIME_TYPE } from '../google/google-drive-api.js';
import { DRIVE_FILE_SCOPE, type GoogleEndpoints } from '../google/google-oauth.js';

/**
 * An in-process stand-in for Google's OAuth device flow and the Drive v3 REST API, for tests
 * only. It implements what the archive uses: device codes, token refresh and revocation, file
 * search by parent/name/type, folders, multipart and resumable uploads (with injectable chunk
 * failures), ranged downloads, copies, deletes and the storage quota.
 */

export interface FakeDriveFile {
  id: string;
  name: string;
  mimeType: string;
  parents: string[];
  content: Buffer;
  trashed: boolean;
}

export interface FakeDevice {
  deviceCode: string;
  userCode: string;
  state: 'pending' | 'approved' | 'denied' | 'expired' | 'redeemed';
  grantDrive: boolean;
  email: string;
  slowDown: boolean;
}

interface UploadSession {
  target: { parentId: string; name: string } | { fileId: string };
  contentType: string;
  size: number;
  received: Buffer;
}

export interface FakeGoogleRequest {
  method: string;
  path: string;
}

const ROOT_ID = 'root';

function sendJson(response: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=UTF-8', ...headers });
  response.end(JSON.stringify(body));
}

function driveError(response: ServerResponse, status: number, reason: string, message: string): void {
  sendJson(response, status, { error: { code: status, message, errors: [{ reason, message }] } });
}

async function readBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

function unescapeQuery(value: string): string {
  return value.replace(/\\(.)/g, '$1');
}

function fakeIdToken(email: string): string {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({ email, sub: '1234567890' })}.signature`;
}

export class FakeGoogle {
  readonly clientId = 'fake-client.apps.googleusercontent.com';
  readonly clientSecret = 'fake-client-secret';
  readonly files = new Map<string, FakeDriveFile>();
  readonly devices: FakeDevice[] = [];
  readonly requests: FakeGoogleRequest[] = [];
  /** Tokens passed to /revoke. */
  readonly revoked: string[] = [];
  quota: { limit: number | null; usage: number } = { limit: 15 * 1024 ** 3, usage: 2 * 1024 ** 3 };

  private readonly refreshTokens = new Map<string, { revoked: boolean }>();
  private readonly accessTokens = new Set<string>();
  private readonly sessions = new Map<string, UploadSession>();
  private failingChunks = 0;

  private constructor(
    private readonly server: Server,
    readonly endpoints: GoogleEndpoints,
  ) {}

  static async start(): Promise<FakeGoogle> {
    const server = createServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const fake = new FakeGoogle(server, { oauth: base, api: base });
    server.on('request', (request: IncomingMessage, response: ServerResponse) => {
      fake.handle(request, response).catch((error: unknown) => {
        sendJson(response, 500, { error: { code: 500, message: String(error) } });
      });
    });
    return fake;
  }

  close(): Promise<void> {
    return new Promise((resolve) => this.server.close(() => resolve()));
  }

  // ---- test controls --------------------------------------------------------------------

  get lastDevice(): FakeDevice | undefined {
    return this.devices.at(-1);
  }

  /** The user approves on google.com/device (optionally unticking the Drive permission). */
  approve(userCode: string, options: { grantDrive?: boolean; email?: string } = {}): void {
    const device = this.device(userCode);
    device.state = 'approved';
    device.grantDrive = options.grantDrive ?? true;
    device.email = options.email ?? device.email;
  }

  deny(userCode: string): void {
    this.device(userCode).state = 'denied';
  }

  expire(userCode: string): void {
    this.device(userCode).state = 'expired';
  }

  /** The next poll of this device code answers slow_down. */
  slowDown(userCode: string): void {
    this.device(userCode).slowDown = true;
  }

  /** A refresh token as if a login had completed (for driver tests that skip the device flow). */
  issueRefreshToken(): string {
    const token = `refresh-${randomBytes(12).toString('hex')}`;
    this.refreshTokens.set(token, { revoked: false });
    return token;
  }

  /** Every refresh token stops working (revoked in the Google account, or expired). */
  revokeAll(): void {
    for (const entry of this.refreshTokens.values()) {
      entry.revoked = true;
    }
    this.accessTokens.clear();
  }

  /** Access tokens stop working, so clients must refresh them. */
  expireAccessTokens(): void {
    this.accessTokens.clear();
  }

  /** The next `count` upload chunks fail with 503 and are not stored. */
  failNextChunks(count = 1): void {
    this.failingChunks = count;
  }

  /** The file or folder at a path of names below My Drive, if it exists and is not trashed. */
  fileAt(...names: string[]): FakeDriveFile | undefined {
    let parentId = ROOT_ID;
    let found: FakeDriveFile | undefined;
    for (const name of names) {
      found = [...this.files.values()].find(
        (file) => !file.trashed && file.name === name && file.parents.includes(parentId),
      );
      if (!found) {
        return undefined;
      }
      parentId = found.id;
    }
    return found;
  }

  childrenOf(parentId: string): FakeDriveFile[] {
    return [...this.files.values()].filter((file) => file.parents.includes(parentId));
  }

  // ---- request handling -----------------------------------------------------------------

  private device(userCode: string): FakeDevice {
    const device = this.devices.find((candidate) => candidate.userCode === userCode);
    if (!device) {
      throw new Error(`No device code ${userCode}`);
    }
    return device;
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? '/', 'http://fake');
    const method = request.method ?? 'GET';
    this.requests.push({ method, path: url.pathname });
    const body = await readBody(request);

    if (url.pathname === '/device/code') {
      return this.deviceCode(new URLSearchParams(body.toString()), response);
    }
    if (url.pathname === '/token') {
      return this.token(new URLSearchParams(body.toString()), response);
    }
    if (url.pathname === '/revoke') {
      return this.revoke(new URLSearchParams(body.toString()), response);
    }

    const token = /^Bearer (.+)$/.exec(request.headers.authorization ?? '')?.[1];
    if (!token || !this.accessTokens.has(token)) {
      return driveError(response, 401, 'authError', 'Invalid Credentials');
    }

    const uploadId = url.searchParams.get('upload_id');
    if (uploadId !== null && method === 'PUT') {
      return this.uploadChunk(uploadId, request, body, response);
    }
    const upload = /^\/upload\/drive\/v3\/files(?:\/([^/]+))?$/.exec(url.pathname);
    if (upload) {
      const target = upload[1]
        ? { fileId: decodeURIComponent(upload[1]) }
        : null;
      return url.searchParams.get('uploadType') === 'resumable'
        ? this.startSession(target, request, body, url, response)
        : this.multipart(target, request, body, response);
    }
    if (url.pathname === '/drive/v3/about') {
      const quota: Record<string, string> = { usage: String(this.quota.usage) };
      if (this.quota.limit !== null) {
        quota['limit'] = String(this.quota.limit);
      }
      return sendJson(response, 200, { storageQuota: quota });
    }
    if (url.pathname === '/drive/v3/files') {
      if (method === 'GET') {
        return sendJson(response, 200, { files: this.search(url.searchParams.get('q') ?? '').map((file) => this.meta(file)) });
      }
      const metadata = JSON.parse(body.toString() || '{}') as { name: string; mimeType?: string; parents?: string[] };
      return sendJson(response, 200, this.meta(this.create(metadata.name, metadata.mimeType ?? 'application/octet-stream', metadata.parents?.[0] ?? ROOT_ID, Buffer.alloc(0))));
    }
    const copy = /^\/drive\/v3\/files\/([^/]+)\/copy$/.exec(url.pathname);
    if (copy && method === 'POST') {
      const source = this.files.get(decodeURIComponent(copy[1] as string));
      if (!source) {
        return driveError(response, 404, 'notFound', 'File not found');
      }
      const metadata = JSON.parse(body.toString() || '{}') as { name?: string; parents?: string[] };
      const copied = this.create(metadata.name ?? source.name, source.mimeType, metadata.parents?.[0] ?? source.parents[0] ?? ROOT_ID, Buffer.from(source.content));
      return sendJson(response, 200, this.meta(copied));
    }
    const single = /^\/drive\/v3\/files\/([^/]+)$/.exec(url.pathname);
    if (single) {
      const file = this.files.get(decodeURIComponent(single[1] as string));
      if (!file) {
        return driveError(response, 404, 'notFound', 'File not found');
      }
      if (method === 'DELETE') {
        this.remove(file.id);
        response.writeHead(204).end();
        return;
      }
      if (url.searchParams.get('alt') === 'media') {
        return this.download(file, request.headers.range, response);
      }
      return sendJson(response, 200, this.meta(file));
    }
    driveError(response, 404, 'notFound', `No route ${method} ${url.pathname}`);
  }

  private deviceCode(form: URLSearchParams, response: ServerResponse): void {
    if (form.get('client_id') !== this.clientId) {
      return sendJson(response, 401, { error: 'invalid_client' });
    }
    const device: FakeDevice = {
      deviceCode: `device-${randomBytes(12).toString('hex')}`,
      userCode: `${randomBytes(2).toString('hex')}-${randomBytes(2).toString('hex')}`.toUpperCase(),
      state: 'pending',
      grantDrive: true,
      email: 'archivist@example.com',
      slowDown: false,
    };
    this.devices.push(device);
    sendJson(response, 200, {
      device_code: device.deviceCode,
      user_code: device.userCode,
      verification_url: 'https://www.google.com/device',
      expires_in: 1800,
      interval: 5,
    });
  }

  private token(form: URLSearchParams, response: ServerResponse): void {
    if (form.get('client_id') !== this.clientId || form.get('client_secret') !== this.clientSecret) {
      return sendJson(response, 401, { error: 'invalid_client' });
    }
    if (form.get('grant_type') === 'refresh_token') {
      const entry = this.refreshTokens.get(form.get('refresh_token') ?? '');
      if (!entry || entry.revoked) {
        return sendJson(response, 400, { error: 'invalid_grant' });
      }
      return sendJson(response, 200, { access_token: this.issueAccessToken(), expires_in: 3599, token_type: 'Bearer' });
    }
    const device = this.devices.find((candidate) => candidate.deviceCode === form.get('device_code'));
    if (!device || device.state === 'redeemed') {
      return sendJson(response, 400, { error: 'invalid_grant' });
    }
    if (device.slowDown) {
      device.slowDown = false;
      return sendJson(response, 403, { error: 'slow_down' });
    }
    switch (device.state) {
      case 'pending':
        return sendJson(response, 428, { error: 'authorization_pending' });
      case 'denied':
        return sendJson(response, 403, { error: 'access_denied' });
      case 'expired':
        return sendJson(response, 400, { error: 'expired_token' });
      default: {
        device.state = 'redeemed';
        const refreshToken = this.issueRefreshToken();
        const scopes = ['openid', 'https://www.googleapis.com/auth/userinfo.email'];
        if (device.grantDrive) {
          scopes.push(DRIVE_FILE_SCOPE);
        }
        return sendJson(response, 200, {
          access_token: this.issueAccessToken(),
          expires_in: 3599,
          refresh_token: refreshToken,
          scope: scopes.join(' '),
          token_type: 'Bearer',
          id_token: fakeIdToken(device.email),
        });
      }
    }
  }

  private revoke(form: URLSearchParams, response: ServerResponse): void {
    const token = form.get('token') ?? '';
    const entry = this.refreshTokens.get(token);
    if (!entry && !this.accessTokens.has(token)) {
      return sendJson(response, 400, { error: 'invalid_token' });
    }
    this.revoked.push(token);
    if (entry) {
      entry.revoked = true;
    }
    sendJson(response, 200, {});
  }

  private issueAccessToken(): string {
    const token = `access-${randomBytes(12).toString('hex')}`;
    this.accessTokens.add(token);
    return token;
  }

  private search(q: string): FakeDriveFile[] {
    const parent = /'((?:[^'\\]|\\.)*)' in parents/.exec(q)?.[1];
    const name = /name = '((?:[^'\\]|\\.)*)'/.exec(q)?.[1];
    const mime = /mimeType (=|!=) '((?:[^'\\]|\\.)*)'/.exec(q);
    return [...this.files.values()].filter(
      (file) =>
        !file.trashed &&
        (parent === undefined || file.parents.includes(unescapeQuery(parent))) &&
        (name === undefined || file.name === unescapeQuery(name)) &&
        (mime === null || (file.mimeType === unescapeQuery(mime[2] as string)) === (mime[1] === '=')),
    );
  }

  private create(name: string, mimeType: string, parentId: string, content: Buffer): FakeDriveFile {
    const file: FakeDriveFile = {
      id: `f${randomBytes(8).toString('hex')}`,
      name,
      mimeType,
      parents: [parentId],
      content,
      trashed: false,
    };
    this.files.set(file.id, file);
    return file;
  }

  private remove(id: string): void {
    for (const child of this.childrenOf(id)) {
      this.remove(child.id);
    }
    this.files.delete(id);
  }

  private meta(file: FakeDriveFile): Record<string, unknown> {
    const folder = file.mimeType === DRIVE_FOLDER_MIME_TYPE;
    return {
      id: file.id,
      name: file.name,
      mimeType: file.mimeType,
      trashed: file.trashed,
      ...(folder
        ? {}
        : {
            size: String(file.content.length),
            sha256Checksum: createHash('sha256').update(file.content).digest('hex'),
          }),
    };
  }

  private download(file: FakeDriveFile, range: string | undefined, response: ServerResponse): void {
    const match = range === undefined ? null : /^bytes=(\d+)-(\d+)$/.exec(range);
    if (match) {
      const start = Number(match[1]);
      const end = Math.min(Number(match[2]), file.content.length - 1);
      response.writeHead(206, {
        'content-type': file.mimeType,
        'content-range': `bytes ${start}-${end}/${file.content.length}`,
      });
      response.end(file.content.subarray(start, end + 1));
      return;
    }
    response.writeHead(200, { 'content-type': file.mimeType });
    response.end(file.content);
  }

  private multipart(
    target: { fileId: string } | null,
    request: IncomingMessage,
    body: Buffer,
    response: ServerResponse,
  ): void {
    const boundary = /boundary=([^;]+)/.exec(request.headers['content-type'] ?? '')?.[1];
    if (!boundary) {
      return driveError(response, 400, 'badRequest', 'No multipart boundary');
    }
    const delimiter = Buffer.from(`--${boundary}`);
    const parts: Buffer[] = [];
    let start = body.indexOf(delimiter);
    while (start !== -1) {
      const next = body.indexOf(delimiter, start + delimiter.length);
      if (next === -1) {
        break;
      }
      parts.push(body.subarray(start + delimiter.length + 2, next - 2));
      start = next;
    }
    const [metadataPart, mediaPart] = parts.map((part) => {
      const split = part.indexOf('\r\n\r\n');
      return { headers: part.subarray(0, split).toString(), content: part.subarray(split + 4) };
    });
    if (!metadataPart || !mediaPart) {
      return driveError(response, 400, 'badRequest', 'Expected metadata and media parts');
    }
    const contentType = /Content-Type: ([^\r\n]+)/i.exec(mediaPart.headers)?.[1] ?? 'application/octet-stream';
    const content = Buffer.from(mediaPart.content);
    if (target) {
      const file = this.files.get(target.fileId);
      if (!file) {
        return driveError(response, 404, 'notFound', 'File not found');
      }
      file.content = content;
      return sendJson(response, 200, this.meta(file));
    }
    const metadata = JSON.parse(metadataPart.content.toString()) as { name: string; parents?: string[] };
    const parentId = metadata.parents?.[0] ?? ROOT_ID;
    if (parentId !== ROOT_ID && !this.files.has(parentId)) {
      return driveError(response, 404, 'notFound', 'Parent folder not found');
    }
    sendJson(response, 200, this.meta(this.create(metadata.name, contentType, parentId, content)));
  }

  private startSession(
    target: { fileId: string } | null,
    request: IncomingMessage,
    body: Buffer,
    url: URL,
    response: ServerResponse,
  ): void {
    const size = Number(request.headers['x-upload-content-length']);
    const contentType = String(request.headers['x-upload-content-type'] ?? 'application/octet-stream');
    let sessionTarget: UploadSession['target'];
    if (target) {
      if (!this.files.has(target.fileId)) {
        return driveError(response, 404, 'notFound', 'File not found');
      }
      sessionTarget = target;
    } else {
      const metadata = JSON.parse(body.toString() || '{}') as { name: string; parents?: string[] };
      sessionTarget = { parentId: metadata.parents?.[0] ?? ROOT_ID, name: metadata.name };
    }
    const id = randomBytes(12).toString('hex');
    this.sessions.set(id, { target: sessionTarget, contentType, size, received: Buffer.alloc(0) });
    const base = `http://${request.headers.host ?? '127.0.0.1'}`;
    response.writeHead(200, { location: `${base}${url.pathname}?uploadType=resumable&upload_id=${id}` });
    response.end();
  }

  private uploadChunk(id: string, request: IncomingMessage, body: Buffer, response: ServerResponse): void {
    const session = this.sessions.get(id);
    if (!session) {
      return driveError(response, 404, 'notFound', 'Upload session not found');
    }
    const range = String(request.headers['content-range'] ?? '');
    const status = /^bytes \*\/(\d+)$/.exec(range);
    const chunk = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(range);
    if (!status && chunk) {
      if (this.failingChunks > 0) {
        this.failingChunks -= 1;
        return driveError(response, 503, 'backendError', 'Backend Error');
      }
      if (Number(chunk[1]) === session.received.length) {
        session.received = Buffer.concat([session.received, body]);
      }
    }
    if (session.received.length < session.size) {
      const headers: Record<string, string> =
        session.received.length > 0 ? { range: `bytes=0-${session.received.length - 1}` } : {};
      response.writeHead(308, headers);
      response.end();
      return;
    }
    this.sessions.delete(id);
    let file: FakeDriveFile;
    if ('fileId' in session.target) {
      file = this.files.get(session.target.fileId) as FakeDriveFile;
      file.content = session.received;
    } else {
      file = this.create(session.target.name, session.contentType, session.target.parentId, session.received);
    }
    sendJson(response, 200, this.meta(file));
  }
}
