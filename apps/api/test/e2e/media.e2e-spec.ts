import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Channel, PrismaClient, StorageLocation } from '@tam/database';
import type {
  ChannelDownloadsDto,
  ChannelDto,
  MediaDto,
  RetryDownloadsDto,
  SettingsDto,
  StorageCheckDto,
} from '@tam/shared';
import { THUMBNAIL_FOLDER, thumbnailKey } from '@tam/storage';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestPrisma, insertUser } from './support/database.js';
import { expectApiError, nextClientIp, sessionCookie } from './support/http.js';
import { createTestApp } from './support/test-app.js';

const EMAIL = 'media-owner@example.test';
const PASSWORD = 'correct horse battery staple';
const MIB = 1024 * 1024;

/** Collects a binary body (supertest only buffers text types by itself). */
function binary(
  response: request.Response,
  callback: (error: Error | null, body: Buffer) => void,
): void {
  // At this point superagent hands over the raw incoming message.
  const stream = response as unknown as NodeJS.ReadableStream;
  const chunks: Buffer[] = [];
  stream.on('data', (chunk: Buffer) => chunks.push(chunk));
  stream.on('end', () => callback(null, Buffer.concat(chunks)));
}

interface ArchivedFile {
  messageId: number;
  size: number;
  type?: 'VIDEO' | 'DOCUMENT' | 'PHOTO';
  mimeType?: string;
  fileName?: string | null;
  jobStatus?: 'PENDING' | 'ACTIVE' | 'FAILED' | 'SKIPPED' | 'COMPLETED';
  reason?: 'POLICY' | null;
  requested?: boolean;
}

describe('media, downloads and settings (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let cookie: string;
  let builtIn: StorageLocation;
  const root = process.env['STORAGE_LOCAL_ROOT'] as string;

  const http = () => request(app.getHttpServer());
  const get = (url: string) => http().get(url).set('Cookie', cookie);
  const send = (method: 'post' | 'patch', url: string, body?: object) =>
    http()[method](url).set('Cookie', cookie).set('X-Forwarded-For', nextClientIp()).send(body);

  beforeAll(async () => {
    prisma = createTestPrisma();
    await prisma.$executeRaw`TRUNCATE TABLE users, sessions, storage_locations CASCADE`;
    await insertUser(prisma, EMAIL, PASSWORD);
    app = await createTestApp();
    const login = await http()
      .post('/api/auth/login')
      .set('X-Forwarded-For', nextClientIp())
      .send({ email: EMAIL, password: PASSWORD })
      .expect(200);
    cookie = sessionCookie(login);
    // The api creates the built-in location ("This computer") when it starts.
    builtIn = await prisma.storageLocation.findFirstOrThrow({ where: { builtIn: true } });
  });

  beforeEach(async () => {
    await prisma.$executeRaw`
      TRUNCATE TABLE channels, messages, media, import_jobs, download_jobs, app_settings CASCADE`;
    await prisma.storageLocation.update({
      where: { id: builtIn.id },
      data: { unavailableUntil: null, lastError: null },
    });
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  let chatSequence = 0;
  async function addChannel(data: Partial<Channel> = {}): Promise<Channel> {
    chatSequence += 1;
    return prisma.channel.create({
      data: {
        telegramChatId: BigInt(-1_002_000_000_000 - chatSequence),
        title: `Lessons ${chatSequence}`,
        type: 'CHANNEL',
        ...data,
      },
    });
  }

  /** Media rows with a download job each, as the importer records them. */
  async function archive(
    channel: Channel,
    files: readonly ArchivedFile[],
    importJobId: string | null = null,
  ) {
    const created: { mediaId: string; downloadJobId: string }[] = [];
    for (const file of files) {
      const message = await prisma.message.create({
        data: {
          channelId: channel.id,
          telegramMessageId: file.messageId,
          type: file.type ?? 'VIDEO',
          telegramDate: new Date(Date.UTC(2026, 0, 1) + file.messageId * 60_000),
        },
      });
      const status = file.jobStatus ?? 'PENDING';
      const media = await prisma.media.create({
        data: {
          messageId: message.id,
          telegramFileId: `${channel.telegramChatId}:${file.messageId}:file-${file.messageId}`,
          telegramFileUniqueId: `file-${file.messageId}`,
          type: file.type ?? 'VIDEO',
          filename: file.fileName === undefined ? `lesson-${file.messageId}.mp4` : file.fileName,
          mimeType: file.mimeType ?? 'video/mp4',
          size: BigInt(file.size),
          downloadStatus:
            status === 'ACTIVE' ? 'DOWNLOADING' : status === 'COMPLETED' ? 'DOWNLOADED' : status,
        },
      });
      const job = await prisma.downloadJob.create({
        data: {
          mediaId: media.id,
          importJobId,
          status,
          reason: file.reason ?? null,
          requestedAt: file.requested ? new Date() : null,
          attempts: status === 'FAILED' ? 8 : 0,
          error: status === 'FAILED' ? 'boom' : null,
        },
      });
      created.push({ mediaId: media.id, downloadJobId: job.id });
    }
    return created;
  }

  /** Puts `content` where the downloader stores the file, and records it as downloaded. */
  async function store(mediaId: string, key: string, content: Buffer): Promise<void> {
    const file = path.join(root, ...key.split('/'));
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, content);
    await prisma.media.update({
      where: { id: mediaId },
      data: {
        downloadStatus: 'DOWNLOADED',
        storageLocationId: builtIn.id,
        storageKey: key,
        checksum: createHash('sha256').update(content).digest('hex'),
        size: BigInt(content.length),
      },
    });
  }

  const jobOf = (id: string) => prisma.downloadJob.findUniqueOrThrow({ where: { id } });
  const mediaOf = (id: string) => prisma.media.findUniqueOrThrow({ where: { id } });

  it.each([
    ['get', '/api/settings'],
    ['patch', '/api/settings'],
    ['get', `/api/media/${randomUUID()}`],
    ['get', `/api/media/${randomUUID()}/content`],
    ['get', `/api/media/${randomUUID()}/thumbnail`],
    ['post', `/api/media/${randomUUID()}/download`],
    ['post', `/api/media/${randomUUID()}/cancel`],
    ['get', `/api/channels/${randomUUID()}/downloads`],
    ['post', `/api/channels/${randomUUID()}/downloads/retry`],
  ] as const)('%s %s requires a session', async (method, url) => {
    expectApiError(await http()[method](url), 401, 'UNAUTHENTICATED');
  });

  describe('settings', () => {
    it('downloads everything by default and tells the server minimum', async () => {
      const body = (await get('/api/settings').expect(200)).body as SettingsDto;
      expect(body).toEqual({
        downloads: {
          paused: false,
          mediaTypes: [
            'PHOTO',
            'VIDEO',
            'DOCUMENT',
            'AUDIO',
            'VOICE',
            'ANIMATION',
            'VIDEO_NOTE',
            'STICKER',
          ],
          maxFileSizeMb: null,
          concurrency: 2,
        },
        sync: { intervalMinutes: 15 },
        disk: { minFreeDiskMb: 2048 },
      });
    });

    it('changes only the given fields and refuses bad values', async () => {
      const body = (
        await send('patch', '/api/settings', { downloads: { concurrency: 3 } }).expect(200)
      ).body as SettingsDto;
      expect(body.downloads).toMatchObject({ concurrency: 3, paused: false, maxFileSizeMb: null });
      expect(
        ((await get('/api/settings').expect(200)).body as SettingsDto).downloads.concurrency,
      ).toBe(3);

      expectApiError(
        await send('patch', '/api/settings', { downloads: {} }),
        400,
        'VALIDATION_FAILED',
      );
      expectApiError(await send('patch', '/api/settings', {}), 400, 'VALIDATION_FAILED');
      expectApiError(
        await send('patch', '/api/settings', { downloads: { concurrency: 9 } }),
        400,
        'VALIDATION_FAILED',
      );
      expectApiError(
        await send('patch', '/api/settings', { downloads: { mediaTypes: ['EXE'] } }),
        400,
        'VALIDATION_FAILED',
      );
    });

    it('changes how often channels are checked for new messages', async () => {
      const body = (
        await send('patch', '/api/settings', { sync: { intervalMinutes: 180 } }).expect(200)
      ).body as SettingsDto;
      expect(body.sync).toEqual({ intervalMinutes: 180 });
      // The download settings stay as they were.
      expect(body.downloads.concurrency).toBe(2);
      expect(((await get('/api/settings').expect(200)).body as SettingsDto).sync).toEqual({
        intervalMinutes: 180,
      });

      const both = (
        await send('patch', '/api/settings', {
          downloads: { concurrency: 1 },
          sync: { intervalMinutes: 60 },
        }).expect(200)
      ).body as SettingsDto;
      expect(both).toMatchObject({ downloads: { concurrency: 1 }, sync: { intervalMinutes: 60 } });
      expectApiError(
        await send('patch', '/api/settings', { sync: { intervalMinutes: 5 } }),
        400,
        'VALIDATION_FAILED',
      );
      expectApiError(await send('patch', '/api/settings', { sync: {} }), 400, 'VALIDATION_FAILED');
    });

    it('applies new types and sizes to files that wait, never to files someone asked for', async () => {
      const channel = await addChannel();
      const [video, document, photo, requested] = await archive(channel, [
        { messageId: 1, size: 300 * MIB },
        { messageId: 2, size: 10_000, type: 'DOCUMENT', mimeType: 'application/pdf' },
        {
          messageId: 3,
          size: 50_000,
          type: 'PHOTO',
          mimeType: 'image/jpeg',
          jobStatus: 'SKIPPED',
          reason: 'POLICY',
        },
        { messageId: 4, size: 400 * MIB, requested: true },
      ]);

      await send('patch', '/api/settings', {
        downloads: { mediaTypes: ['PHOTO', 'DOCUMENT'] },
      }).expect(200);
      expect(await jobOf(video!.downloadJobId)).toMatchObject({
        status: 'SKIPPED',
        reason: 'POLICY',
      });
      expect((await mediaOf(video!.mediaId)).downloadStatus).toBe('SKIPPED');
      expect(await jobOf(document!.downloadJobId)).toMatchObject({ status: 'PENDING' });
      expect(await jobOf(photo!.downloadJobId)).toMatchObject({ status: 'PENDING', reason: null });
      expect((await mediaOf(photo!.mediaId)).downloadStatus).toBe('PENDING');
      expect(await jobOf(requested!.downloadJobId)).toMatchObject({ status: 'PENDING' });

      await send('patch', '/api/settings', {
        downloads: { mediaTypes: ['VIDEO', 'PHOTO', 'DOCUMENT'], maxFileSizeMb: 100 },
      }).expect(200);
      // Allowed again by type, but too large now.
      expect(await jobOf(video!.downloadJobId)).toMatchObject({
        status: 'SKIPPED',
        reason: 'POLICY',
      });
      await send('patch', '/api/settings', { downloads: { maxFileSizeMb: null } }).expect(200);
      expect(await jobOf(video!.downloadJobId)).toMatchObject({ status: 'PENDING', reason: null });
    });

    it('pausing takes running downloads away from the worker', async () => {
      const channel = await addChannel();
      const [running] = await archive(channel, [
        { messageId: 1, size: 5_000, jobStatus: 'ACTIVE' },
      ]);
      await send('patch', '/api/settings', { downloads: { paused: true } }).expect(200);
      expect(await jobOf(running!.downloadJobId)).toMatchObject({ status: 'PENDING', attempts: 0 });
      expect((await mediaOf(running!.mediaId)).downloadStatus).toBe('PENDING');
    });
  });

  describe('media', () => {
    it('describes a file without server paths or Telegram ids', async () => {
      const channel = await addChannel();
      const [file] = await archive(channel, [{ messageId: 7, size: 1_234 }]);
      const body = (await get(`/api/media/${file!.mediaId}`).expect(200)).body as MediaDto;
      expect(body).toMatchObject({
        id: file!.mediaId,
        channelId: channel.id,
        telegramMessageId: 7,
        type: 'VIDEO',
        fileName: 'lesson-7.mp4',
        size: 1_234,
        downloadStatus: 'PENDING',
        skipReason: null,
        requested: false,
        storageLocation: null,
        hasThumbnail: false,
      });
      expect(JSON.stringify(body)).not.toContain('file-7');
      expectApiError(await get(`/api/media/${randomUUID()}`), 404, 'NOT_FOUND');
    });

    it('downloads a file on request, whatever the settings and the channel say', async () => {
      const channel = await addChannel({ downloadMedia: false });
      const [skipped, running, done] = await archive(channel, [
        { messageId: 1, size: 5_000, jobStatus: 'SKIPPED', reason: 'POLICY' },
        { messageId: 2, size: 5_000, jobStatus: 'ACTIVE' },
        { messageId: 3, size: 5_000, jobStatus: 'COMPLETED' },
      ]);

      const queued = (await send('post', `/api/media/${skipped!.mediaId}/download`).expect(202))
        .body as MediaDto;
      expect(queued).toMatchObject({
        downloadStatus: 'PENDING',
        requested: true,
        skipReason: null,
      });
      expect(await jobOf(skipped!.downloadJobId)).toMatchObject({
        status: 'PENDING',
        reason: null,
        attempts: 0,
      });

      await send('post', `/api/media/${running!.mediaId}/download`).expect(200);
      expect((await jobOf(running!.downloadJobId)).requestedAt).not.toBeNull();
      await send('post', `/api/media/${done!.mediaId}/download`).expect(200);

      const locked = await addChannel({ isProtected: true });
      const [protectedFile] = await archive(locked, [{ messageId: 9, size: 5_000 }]);
      expectApiError(
        await send('post', `/api/media/${protectedFile!.mediaId}/download`),
        422,
        'CHAT_PROTECTED',
      );
    });

    it('cancels a waiting file once', async () => {
      const channel = await addChannel();
      const [file] = await archive(channel, [{ messageId: 1, size: 5_000 }]);
      const body = (await send('post', `/api/media/${file!.mediaId}/cancel`).expect(200))
        .body as MediaDto;
      expect(body.downloadStatus).toBe('CANCELLED');
      expect((await jobOf(file!.downloadJobId)).status).toBe('CANCELLED');
      expectApiError(
        await send('post', `/api/media/${file!.mediaId}/cancel`),
        409,
        'INVALID_DOWNLOAD_STATE',
      );
      // Asking for it again brings it back.
      await send('post', `/api/media/${file!.mediaId}/download`).expect(202);
    });

    it('streams a stored file whole or by range, inline only for safe types', async () => {
      const channel = await addChannel();
      const [video, page, pdf] = await archive(channel, [
        { messageId: 1, size: 0 },
        { messageId: 2, size: 0, type: 'DOCUMENT', mimeType: 'text/html', fileName: 'page.html' },
        {
          messageId: 3,
          size: 0,
          type: 'DOCUMENT',
          mimeType: 'application/pdf',
          fileName: 'Bài 1.pdf',
        },
      ]);
      expectApiError(
        await get(`/api/media/${video!.mediaId}/content`),
        409,
        'MEDIA_NOT_DOWNLOADED',
      );

      const content = randomBytes(64 * 1024);
      await store(video!.mediaId, 'Lessons (-1)/2026-01/1 - lesson-1.mp4', content);
      const whole = await get(`/api/media/${video!.mediaId}/content`)
        .buffer(true)
        .parse(binary)
        .expect(200);
      expect((whole.body as Buffer).equals(content)).toBe(true);
      expect(whole.headers).toMatchObject({
        'content-type': 'video/mp4',
        'content-length': String(content.length),
        'accept-ranges': 'bytes',
        'x-content-type-options': 'nosniff',
        'content-security-policy': 'sandbox',
      });
      expect(whole.headers['content-disposition']).toMatch(/^inline; filename="lesson-1.mp4"/);

      const part = await get(`/api/media/${video!.mediaId}/content`)
        .set('Range', 'bytes=100-199')
        .buffer(true)
        .parse(binary)
        .expect(206);
      expect(part.headers['content-range']).toBe(`bytes 100-199/${content.length}`);
      expect((part.body as Buffer).equals(content.subarray(100, 200))).toBe(true);
      const tail = await get(`/api/media/${video!.mediaId}/content`)
        .set('Range', 'bytes=-10')
        .buffer(true)
        .parse(binary)
        .expect(206);
      expect((tail.body as Buffer).equals(content.subarray(content.length - 10))).toBe(true);
      const outside = await get(`/api/media/${video!.mediaId}/content`)
        .set('Range', `bytes=${content.length}-`)
        .expect(416);
      expect(outside.headers['content-range']).toBe(`bytes */${content.length}`);

      const asked = await get(`/api/media/${video!.mediaId}/content?download=1`)
        .buffer(true)
        .parse(binary)
        .expect(200);
      expect(asked.headers['content-disposition']).toMatch(/^attachment;/);

      await store(
        page!.mediaId,
        'Lessons (-1)/2026-01/2 - page.html',
        Buffer.from('<script>alert(1)</script>'),
      );
      const html = await get(`/api/media/${page!.mediaId}/content`)
        .buffer(true)
        .parse(binary)
        .expect(200);
      expect(html.headers['content-disposition']).toMatch(/^attachment;/);

      await store(pdf!.mediaId, 'Lessons (-1)/2026-01/3 - Bài 1.pdf', Buffer.from('%PDF-1.4'));
      const document = await get(`/api/media/${pdf!.mediaId}/content`)
        .buffer(true)
        .parse(binary)
        .expect(200);
      expect(document.headers['content-disposition']).toBe(
        `inline; filename="Bai 1.pdf"; filename*=UTF-8''B%C3%A0i%201.pdf`,
      );
      expect(document.headers['content-security-policy']).not.toBe('sandbox');

      await rm(path.join(root, 'Lessons (-1)', '2026-01', '1 - lesson-1.mp4'));
      expectApiError(await get(`/api/media/${video!.mediaId}/content`), 404, 'NOT_FOUND');
    });

    it('serves the preview from the thumbnail cache', async () => {
      const channel = await addChannel();
      const [withPreview, withoutPreview] = await archive(channel, [
        { messageId: 1, size: 5_000 },
        { messageId: 2, size: 5_000 },
      ]);
      const key = thumbnailKey(withPreview!.mediaId, 'jpg');
      const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), randomBytes(100)]);
      const file = path.join(root, THUMBNAIL_FOLDER, ...key.split('/'));
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, jpeg);
      await prisma.media.update({
        where: { id: withPreview!.mediaId },
        data: { thumbnailKey: key },
      });

      const response = await get(`/api/media/${withPreview!.mediaId}/thumbnail`)
        .buffer(true)
        .parse(binary)
        .expect(200);
      expect((response.body as Buffer).equals(jpeg)).toBe(true);
      expect(response.headers).toMatchObject({
        'content-type': 'image/jpeg',
        'cache-control': 'private, max-age=86400',
      });
      expect(
        ((await get(`/api/media/${withPreview!.mediaId}`).expect(200)).body as MediaDto)
          .hasThumbnail,
      ).toBe(true);
      expectApiError(
        await get(`/api/media/${withoutPreview!.mediaId}/thumbnail`),
        404,
        'NOT_FOUND',
      );
    });
  });

  describe('channel downloads', () => {
    it('switches automatic downloads for the channel and its old basic group', async () => {
      const channel = await addChannel({
        downloadNote: 'This Telegram account can no longer read the chat',
      });
      const oldGroup = await addChannel({ type: 'GROUP', migratedToChannelId: channel.id });
      const [running, requested] = await archive(channel, [
        { messageId: 1, size: 5_000, jobStatus: 'ACTIVE' },
        { messageId: 2, size: 5_000, jobStatus: 'ACTIVE', requested: true },
      ]);
      const [oldRunning] = await archive(oldGroup, [
        { messageId: 3, size: 5_000, jobStatus: 'ACTIVE' },
      ]);

      const off = (
        await send('patch', `/api/channels/${channel.id}`, { downloadMedia: false }).expect(200)
      ).body as ChannelDto;
      expect(off).toMatchObject({ downloadMedia: false });
      expect(
        (await prisma.channel.findUniqueOrThrow({ where: { id: oldGroup.id } })).downloadMedia,
      ).toBe(false);
      expect((await jobOf(running!.downloadJobId)).status).toBe('PENDING');
      expect((await jobOf(oldRunning!.downloadJobId)).status).toBe('PENDING');
      // Someone asked for this one: it goes on.
      expect((await jobOf(requested!.downloadJobId)).status).toBe('ACTIVE');

      const on = (
        await send('patch', `/api/channels/${channel.id}`, { downloadMedia: true }).expect(200)
      ).body as ChannelDto;
      expect(on).toMatchObject({ downloadMedia: true, downloadNote: null });
    });

    it('switches sync, and never for protected chats or old groups', async () => {
      const channel = await addChannel({
        syncEnabled: false,
        syncNote: 'This account can no longer read the chat',
      });
      expect(channel.syncEnabled).toBe(false);
      const on = (
        await send('patch', `/api/channels/${channel.id}`, { syncEnabled: true }).expect(200)
      ).body as ChannelDto;
      // Switched on again: why it had stopped no longer applies.
      expect(on).toMatchObject({ syncEnabled: true, syncNote: null });
      const off = (
        await send('patch', `/api/channels/${channel.id}`, { syncEnabled: false }).expect(200)
      ).body as ChannelDto;
      expect(off).toMatchObject({ syncEnabled: false, syncNote: null });

      const protectedChat = await addChannel({ isProtected: true, syncEnabled: false });
      expectApiError(
        await send('patch', `/api/channels/${protectedChat.id}`, { syncEnabled: true }),
        422,
        'CHAT_PROTECTED',
      );
      const oldGroup = await addChannel({
        type: 'GROUP',
        migratedToChannelId: channel.id,
        syncEnabled: false,
      });
      expectApiError(
        await send('patch', `/api/channels/${oldGroup.id}`, { syncEnabled: true }),
        422,
        'CHANNEL_MIGRATED',
      );
      await send('patch', `/api/channels/${oldGroup.id}`, { syncEnabled: false }).expect(200);
      expectApiError(
        await send('patch', `/api/channels/${channel.id}`, {}),
        400,
        'VALIDATION_FAILED',
      );
    });

    it('syncs new channels by default', async () => {
      expect((await addChannel()).syncEnabled).toBe(true);
    });

    it('sums up files, bytes, running downloads and room in the location', async () => {
      const channel = await addChannel();
      await archive(channel, [
        { messageId: 1, size: 1_000, jobStatus: 'COMPLETED' },
        { messageId: 2, size: 2_000 },
        {
          messageId: 3,
          size: 3_000,
          jobStatus: 'ACTIVE',
          fileName: null,
          mimeType: 'image/jpeg',
          type: 'PHOTO',
        },
        { messageId: 4, size: 4_000, jobStatus: 'FAILED' },
        { messageId: 5, size: 5_000, jobStatus: 'SKIPPED', reason: 'POLICY' },
      ]);
      const summary = (await get(`/api/channels/${channel.id}/downloads`).expect(200))
        .body as ChannelDownloadsDto;
      expect(summary).toMatchObject({
        channelId: channel.id,
        downloadMedia: true,
        paused: false,
        files: { pending: 1, active: 1, downloaded: 1, failed: 1, skipped: 1, cancelled: 0 },
        bytes: { total: 15_000, downloaded: 1_000, remaining: 5_000 },
        location: { id: builtIn.id, kind: 'LOCAL', name: 'This computer', unavailableUntil: null },
      });
      expect(summary.active).toEqual([
        expect.objectContaining({ name: '3.jpg', type: 'PHOTO', size: 3_000 }),
      ]);
      expect(summary.location?.freeBytes).toEqual(expect.any(Number));
      expect(summary.fits).toBe(true);

      const huge = await addChannel();
      await archive(huge, [{ messageId: 1, size: 2 ** 52 }]);
      expect(
        ((await get(`/api/channels/${huge.id}/downloads`).expect(200)).body as ChannelDownloadsDto)
          .fits,
      ).toBe(false);
      expectApiError(await get(`/api/channels/${randomUUID()}/downloads`), 404, 'NOT_FOUND');
    });

    it('puts failed files back in line and recounts the import', async () => {
      const channel = await addChannel();
      const job = await prisma.importJob.create({
        data: { channelId: channel.id, status: 'COMPLETED', phase: 'DONE', failedFiles: 2 },
      });
      const [first] = await archive(
        channel,
        [
          { messageId: 1, size: 1_000, jobStatus: 'FAILED' },
          { messageId: 2, size: 1_000, jobStatus: 'FAILED' },
          { messageId: 3, size: 1_000 },
        ],
        job.id,
      );
      const body = (await send('post', `/api/channels/${channel.id}/downloads/retry`).expect(200))
        .body as RetryDownloadsDto;
      expect(body).toEqual({ queued: 2 });
      expect(await jobOf(first!.downloadJobId)).toMatchObject({
        status: 'PENDING',
        attempts: 0,
        error: null,
      });
      expect((await jobOf(first!.downloadJobId)).requestedAt).not.toBeNull();
      expect(await prisma.importJob.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({
        failedFiles: 0,
      });
    });

    it('a successful location check lets waiting downloads go on', async () => {
      await prisma.storageLocation.update({
        where: { id: builtIn.id },
        data: {
          unavailableUntil: new Date(Date.now() + 60 * 60_000),
          lastError: 'Not enough free space',
        },
      });
      const check = (await send('post', `/api/storage/locations/${builtIn.id}/check`).expect(200))
        .body as StorageCheckDto;
      expect(check.ok).toBe(true);
      expect(check.location).toMatchObject({ unavailableUntil: null, lastError: null });
    });
  });
});
