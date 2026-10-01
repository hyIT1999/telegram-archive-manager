import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { PrismaClient } from '@tam/database';
import type {
  ChannelDto,
  GoogleDriveConnectDto,
  GoogleDrivePollDto,
  LocalFolderListDto,
  StorageCheckDto,
  StorageLocationDto,
  StorageLocationListDto,
} from '@tam/shared';
import { FakeGoogle } from '@tam/storage/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GOOGLE_ENDPOINTS } from '../../src/storage/storage.settings.js';
import { createTestPrisma, insertUser } from './support/database.js';
import { expectApiError, nextClientIp, sessionCookie } from './support/http.js';
import { createTestApp } from './support/test-app.js';

const EMAIL = 'storage-owner@example.test';
const PASSWORD = 'correct horse battery staple';

describe('storage locations (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let google: FakeGoogle;
  let cookie: string;
  const builtInRoot = process.env['STORAGE_LOCAL_ROOT'] as string;
  const allowedRoot = process.env['STORAGE_LOCAL_ROOTS'] as string;
  const bodies: unknown[] = [];

  const http = () => request(app.getHttpServer());
  const record = <T>(response: request.Response): T => {
    bodies.push(response.body);
    return response.body as T;
  };
  const get = (url: string) => http().get(url).set('Cookie', cookie);
  const send = (method: 'post' | 'patch' | 'delete', url: string, body?: object) =>
    http()[method](url).set('Cookie', cookie).set('X-Forwarded-For', nextClientIp()).send(body);

  async function locations(): Promise<StorageLocationListDto> {
    return record<StorageLocationListDto>(await get('/api/storage/locations').expect(200));
  }

  async function connectDrive(body: object = { name: 'Drive' }): Promise<GoogleDriveConnectDto> {
    return record<GoogleDriveConnectDto>(await send('post', '/api/storage/google/connect', body).expect(201));
  }

  async function poll(flowId: string, status = 200): Promise<GoogleDrivePollDto> {
    return record<GoogleDrivePollDto>(
      await send('post', `/api/storage/google/connect/${flowId}/poll`).expect(status),
    );
  }

  async function addDrive(body: object = { name: 'Drive' }): Promise<StorageLocationDto> {
    const flow = await connectDrive(body);
    google.approve(flow.userCode, { email: 'teacher@example.com' });
    const result = await poll(flow.flowId);
    expect(result.status).toBe('authorized');
    return result.location as StorageLocationDto;
  }

  beforeAll(async () => {
    google = await FakeGoogle.start();
    prisma = createTestPrisma();
    await prisma.$executeRaw`TRUNCATE TABLE users, sessions, storage_locations, telegram_dialogs, channels CASCADE`;
    await insertUser(prisma, EMAIL, PASSWORD);
    app = await createTestApp((builder) =>
      builder.overrideProvider(GOOGLE_ENDPOINTS).useValue(google.endpoints),
    );
    const login = await http()
      .post('/api/auth/login')
      .set('X-Forwarded-For', nextClientIp())
      .send({ email: EMAIL, password: PASSWORD })
      .expect(200);
    cookie = sessionCookie(login);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
    await google.close();
    // No response ever carried Google credentials.
    expect(JSON.stringify(bodies)).not.toMatch(/refresh-|access-|device-/);
  });

  it('requires a session', async () => {
    expectApiError(await http().get('/api/storage/locations'), 401, 'UNAUTHENTICATED');
  });

  it('starts with the built-in folder as the default, and says what can be added', async () => {
    const list = await locations();
    expect(list.items).toEqual([
      expect.objectContaining({
        kind: 'LOCAL',
        name: 'This computer',
        displayPath: builtInRoot,
        isDefault: true,
        builtIn: true,
        accountEmail: null,
        channelCount: 0,
      }),
    ]);
    expect(list.capabilities).toEqual({
      localRoots: [allowedRoot],
      googleDrive: { available: true, reason: null },
      // Nobody signed in to Telegram in these tests.
      telegram: { available: false, reason: expect.stringContaining('Sign in to Telegram') },
    });
  });

  it('browses folders inside the allowed roots only', async () => {
    await mkdir(path.join(allowedRoot, 'Lessons', 'Physics'), { recursive: true });

    const roots = record<LocalFolderListDto>(await get('/api/storage/local/folders').expect(200));
    expect(roots).toEqual({ path: null, parent: null, folders: [{ name: allowedRoot, path: allowedRoot }], truncated: false });

    const top = record<LocalFolderListDto>(
      await get('/api/storage/local/folders').query({ path: allowedRoot }).expect(200),
    );
    expect(top.folders).toContainEqual({ name: 'Lessons', path: path.join(allowedRoot, 'Lessons') });
    expect(top.parent).toBeNull();

    expectApiError(
      await get('/api/storage/local/folders').query({ path: builtInRoot }),
      422,
      'PATH_NOT_ALLOWED',
    );
    expectApiError(
      await get('/api/storage/local/folders').query({ path: path.join(allowedRoot, 'missing') }),
      404,
      'NOT_FOUND',
    );
  });

  it('adds a folder on this computer after writing to it, once per folder', async () => {
    const created = record<StorageLocationDto>(
      await send('post', '/api/storage/locations', {
        name: 'Lessons archive',
        path: path.join(allowedRoot, 'Lessons'),
        subfolder: 'Telegram: 2026',
      }).expect(201),
    );
    const folder = path.join(allowedRoot, 'Lessons', 'Telegram_ 2026');
    expect(created).toMatchObject({ kind: 'LOCAL', name: 'Lessons archive', displayPath: folder, isDefault: false });
    expect(created.lastCheckedAt).not.toBeNull();
    expect(await readdir(folder)).toEqual([]);

    expectApiError(
      await send('post', '/api/storage/locations', { name: 'Again', path: folder }),
      409,
      'LOCATION_EXISTS',
    );
    expectApiError(
      await send('post', '/api/storage/locations', { name: 'Outside', path: builtInRoot }),
      422,
      'PATH_NOT_ALLOWED',
    );
    expectApiError(
      await send('post', '/api/storage/locations', { name: 'Relative', path: 'Lessons' }),
      422,
      'PATH_NOT_ALLOWED',
    );
    expectApiError(await send('post', '/api/storage/locations', { name: '', path: folder }), 400, 'VALIDATION_FAILED');
  });

  it('checks a location, reports problems, and changes the default', async () => {
    const folder = path.join(allowedRoot, 'Checked');
    const location = record<StorageLocationDto>(
      await send('post', '/api/storage/locations', { name: 'Checked', path: folder }).expect(201),
    );

    const check = record<StorageCheckDto>(
      await send('post', `/api/storage/locations/${location.id}/check`).expect(200),
    );
    expect(check.ok).toBe(true);
    expect(check.space?.freeBytes).toBeGreaterThan(0);
    expect(check.location.lastError).toBeNull();

    // A file where the folder should be: the location can no longer be written.
    await rm(folder, { recursive: true, force: true });
    await writeFile(folder, 'not a folder');
    const failed = record<StorageCheckDto>(
      await send('post', `/api/storage/locations/${location.id}/check`).expect(200),
    );
    expect(failed.ok).toBe(false);
    expect(failed.space).toBeNull();
    expect(failed.location.lastError).toMatch(/not a folder|Cannot use/);
    await rm(folder, { force: true });

    await send('patch', `/api/storage/locations/${location.id}`, { isDefault: true }).expect(200);
    const defaults = (await locations()).items.filter((item) => item.isDefault);
    expect(defaults.map((item) => item.id)).toEqual([location.id]);

    await send('patch', `/api/storage/locations/${location.id}`, { name: 'Renamed' }).expect(200);
    expectApiError(await send('patch', `/api/storage/locations/${location.id}`, {}), 400, 'VALIDATION_FAILED');
    expectApiError(
      await send('patch', '/api/storage/locations/0199a0b1-0000-7000-8000-00000000dead', { name: 'x' }),
      404,
      'NOT_FOUND',
    );
  });

  it('chooses where a channel saves its media and protects locations in use', async () => {
    const channel = await prisma.channel.create({
      data: { telegramChatId: -1_001_234_567_890n, title: 'Lịch sử: Việt Nam', type: 'CHANNEL' },
    });
    const folder = path.join(allowedRoot, 'Channels');
    const location = record<StorageLocationDto>(
      await send('post', '/api/storage/locations', { name: 'Channels', path: folder }).expect(201),
    );

    const updated = record<ChannelDto>(
      await send('patch', `/api/channels/${channel.id}`, { storageLocationId: location.id }).expect(200),
    );
    expect(updated.storageLocation).toEqual({
      id: location.id,
      kind: 'LOCAL',
      name: 'Channels',
      displayPath: folder,
    });
    expect(updated.storageFolder).toBe('Lịch sử_ Việt Nam (-1001234567890)');
    expect((await locations()).items.find((item) => item.id === location.id)?.channelCount).toBe(1);

    expectApiError(
      await send('patch', `/api/channels/${channel.id}`, { storageLocationId: '0199a0b1-0000-7000-8000-00000000dead' }),
      404,
      'NOT_FOUND',
    );
    expectApiError(await send('patch', `/api/channels/${channel.id}`, { storageLocationId: 'x' }), 400, 'VALIDATION_FAILED');
    expectApiError(await send('delete', `/api/storage/locations/${location.id}`), 409, 'LOCATION_IN_USE');

    const builtIn = (await locations()).items.find((item) => item.builtIn) as StorageLocationDto;
    expectApiError(await send('delete', `/api/storage/locations/${builtIn.id}`), 409, 'LOCATION_BUILT_IN');

    // The folder name stays when the channel moves, so its files never split over two names.
    await prisma.channel.update({ where: { id: channel.id }, data: { title: 'Renamed in Telegram' } });
    const moved = record<ChannelDto>(
      await send('patch', `/api/channels/${channel.id}`, { storageLocationId: builtIn.id }).expect(200),
    );
    expect(moved.storageFolder).toBe('Lịch sử_ Việt Nam (-1001234567890)');
    await send('delete', `/api/storage/locations/${location.id}`).expect(204);
    expect((await get(`/api/channels/${channel.id}`).expect(200)).body).toMatchObject({
      storageLocation: { id: builtIn.id, name: 'This computer' },
    });
  });

  it('connects Google Drive with a device code and keeps the credentials on the server', async () => {
    const flow = await connectDrive({ name: 'Drive' });
    expect(flow).toMatchObject({ verificationUrl: 'https://www.google.com/device', intervalSeconds: 5 });
    expect(flow.userCode).toMatch(/^[0-9A-F]{4}-[0-9A-F]{4}$/);

    await expect(poll(flow.flowId)).resolves.toEqual({ status: 'pending', location: null, intervalSeconds: 5 });
    google.approve(flow.userCode, { email: 'teacher@example.com' });
    const done = await poll(flow.flowId);
    expect(done).toMatchObject({
      status: 'authorized',
      intervalSeconds: null,
      location: {
        kind: 'GOOGLE_DRIVE',
        name: 'Drive',
        displayPath: 'My Drive › Unofficial Telegram Archive',
        accountEmail: 'teacher@example.com',
        lastError: null,
      },
    });
    expect(google.fileAt('Unofficial Telegram Archive')).toBeDefined();
    expectApiError(await send('post', `/api/storage/google/connect/${flow.flowId}/poll`), 404, 'NOT_FOUND');

    const row = await prisma.storageLocation.findUniqueOrThrow({ where: { id: done.location?.id as string } });
    expect(row.secretEnc).not.toBeNull();
    expect(Buffer.from(row.secretEnc as Uint8Array).toString('latin1')).not.toContain('refresh-');

    const check = record<StorageCheckDto>(
      await send('post', `/api/storage/locations/${row.id}/check`).expect(200),
    );
    expect(check).toMatchObject({ ok: true, space: { totalBytes: google.quota.limit, usedBytes: google.quota.usage } });

    // The same folder again: the location is kept, with fresh credentials.
    const again = await addDrive({ name: 'Drive again' });
    expect(again.id).toBe(row.id);
    expect((await locations()).items.filter((item) => item.kind === 'GOOGLE_DRIVE')).toHaveLength(1);

    const revokedBefore = google.revoked.length;
    await send('delete', `/api/storage/locations/${row.id}`).expect(204);
    expect(google.revoked.length).toBe(revokedBefore + 1);
  });

  it('reports declined, expired and Drive-less sign-ins, and slows down when asked', async () => {
    const declined = await connectDrive();
    google.deny(declined.userCode);
    await expect(poll(declined.flowId)).resolves.toMatchObject({ status: 'denied', location: null });

    const expired = await connectDrive();
    google.expire(expired.userCode);
    await expect(poll(expired.flowId)).resolves.toMatchObject({ status: 'expired' });

    const slow = await connectDrive();
    google.slowDown(slow.userCode);
    await expect(poll(slow.flowId)).resolves.toEqual({ status: 'pending', location: null, intervalSeconds: 10 });

    const noDrive = await connectDrive();
    const revokedBefore = google.revoked.length;
    google.approve(noDrive.userCode, { grantDrive: false });
    expectApiError(
      await send('post', `/api/storage/google/connect/${noDrive.flowId}/poll`),
      422,
      'GOOGLE_SCOPE_DENIED',
    );
    expect(google.revoked.length).toBe(revokedBefore + 1);
    expect((await locations()).items.some((item) => item.kind === 'GOOGLE_DRIVE')).toBe(false);
  });

  it('reconnects a location whose Google access was revoked', async () => {
    const location = await addDrive({ name: 'Lessons Drive', folderName: 'Lessons' });
    google.revokeAll();

    const broken = record<StorageCheckDto>(
      await send('post', `/api/storage/locations/${location.id}/check`).expect(200),
    );
    expect(broken.ok).toBe(false);
    expect(broken.location.lastError).toMatch(/revoked or has expired/);

    const reconnected = await addDrive({ name: 'ignored', locationId: location.id });
    expect(reconnected).toMatchObject({ id: location.id, name: 'Lessons Drive', lastError: null });
    const check = record<StorageCheckDto>(
      await send('post', `/api/storage/locations/${location.id}/check`).expect(200),
    );
    expect(check.ok).toBe(true);

    expectApiError(
      await send('post', '/api/storage/google/connect', {
        name: 'x',
        locationId: (await locations()).items.find((item) => item.builtIn)?.id,
      }),
      404,
      'NOT_FOUND',
    );
  });
});
