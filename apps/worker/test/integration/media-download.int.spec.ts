import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Test, type TestingModule } from '@nestjs/testing';
import { SecretBox } from '@tam/crypto';
import { type Channel, refreshMediaCounters } from '@tam/database';
import type { PrismaService } from '@tam/database/nest';
import { MediaType, type MediaDownloadJobData, QUEUES } from '@tam/shared';
import {
  GoogleAccessTokens,
  LocationDriverFactory,
  ensureTopFolder,
  thumbnailKey,
} from '@tam/storage';
import { FakeGoogle } from '@tam/storage/testing';
import { ChatProtectedError, FloodWaitError } from '@tam/telegram';
import { Queue } from 'bullmq';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  inject,
  it,
  vi,
} from 'vitest';
import { IMPORT_SETTINGS } from '../../src/imports/import-settings.js';
import { DownloadReconciler } from '../../src/media/download-reconciler.js';
import {
  LOCATION_DRIVERS,
  MEDIA_SETTINGS,
  type MediaSettings,
} from '../../src/media/media-settings.js';
import { SYNC_SCHEDULER_SETTINGS } from '../../src/sync/sync-settings.js';
import { ACCOUNT_KEY } from '../../src/telegram/telegram-auth.service.js';
import { TELEGRAM_API_PROVIDER } from '../../src/telegram/telegram.tokens.js';
import { WorkerModule } from '../../src/worker.module.js';
import { FakeFiles } from './support/fake-files.js';
import { IDLE_SYNC_SETTINGS } from './support/sync-fixtures.js';
import {
  archiveFiles,
  localLocation,
  saveDownloadSettings,
  testMediaSettings,
} from './support/media-fixtures.js';
import {
  createFakeTelegramApi,
  resetTelegramTables,
  testPrisma,
} from './support/telegram-fixtures.js';
import { TEST_BULLMQ_PREFIX } from './test-env.js';

const CHAT_ID = '-1001000000009';
const FOLDER = `Lessons (${CHAT_ID})`;
/** Messages of fake-chats' dateOf() are posted in January 2026. */
const MONTH = '2026-01';
const MIB = 1024 * 1024;
const DRIVE_TOP = 'Unofficial Telegram Archive';

const sha256 = (data: Buffer) => createHash('sha256').update(data).digest('hex');
const silent = { log() {}, error() {}, warn() {}, debug() {}, verbose() {}, fatal() {} };

describe('media downloads', () => {
  let prisma: PrismaService;
  let base: string;
  let root: string;
  let app: TestingModule | undefined;
  /** Reads the queue from outside the application. */
  const inspector = new Queue<MediaDownloadJobData>(QUEUES.mediaDownload, {
    connection: { url: inject('redisUrl') },
    prefix: TEST_BULLMQ_PREFIX,
  });

  beforeAll(() => {
    prisma = testPrisma();
  });
  beforeEach(async () => {
    await resetTelegramTables(prisma);
    await prisma.telegramAccount.create({ data: { accountKey: ACCOUNT_KEY, authState: 'READY' } });
    base = await mkdtemp(path.join(tmpdir(), 'tam-media-'));
    root = path.join(base, 'archive');
  });
  afterEach(async () => {
    await app?.close();
    app = undefined;
    await inspector.obliterate({ force: true });
    await rm(base, { recursive: true, force: true });
  });
  afterAll(async () => {
    await inspector.close();
    await resetTelegramTables(prisma);
    await prisma.$disconnect();
  });

  async function boot(
    fake: ReturnType<typeof createFakeTelegramApi>,
    settings: Partial<MediaSettings> = {},
    drivers?: LocationDriverFactory,
  ): Promise<TestingModule> {
    let builder = Test.createTestingModule({ imports: [WorkerModule] })
      .overrideProvider(TELEGRAM_API_PROVIDER)
      .useValue(fake.provider)
      .overrideProvider(IMPORT_SETTINGS)
      .useValue({ pageDelayMs: 0, unavailableRetryMs: 100, reconcileIntervalMs: 3_600_000 })
      .overrideProvider(MEDIA_SETTINGS)
      .useValue(testMediaSettings(settings))
      .overrideProvider(SYNC_SCHEDULER_SETTINGS)
      .useValue(IDLE_SYNC_SETTINGS);
    if (drivers) {
      builder = builder.overrideProvider(LOCATION_DRIVERS).useValue(drivers);
    }
    const moduleRef = await builder.setLogger(silent).compile();
    await moduleRef.init();
    app = moduleRef;
    return moduleRef;
  }

  function lessons(
    overrides: { downloadMedia?: boolean; isProtected?: boolean } = {},
  ): Promise<Channel> {
    return prisma.channel.create({
      data: { telegramChatId: BigInt(CHAT_ID), title: 'Lessons', type: 'CHANNEL', ...overrides },
    });
  }

  const mediaOf = (id: string) => prisma.media.findUniqueOrThrow({ where: { id } });
  const jobOf = (id: string) => prisma.downloadJob.findUniqueOrThrow({ where: { id } });
  const until = (check: () => Promise<void>, timeout = 15_000) =>
    vi.waitFor(check, { timeout, interval: 50 });
  const downloaded = (mediaId: string) => async () => {
    expect((await mediaOf(mediaId)).downloadStatus).toBe('DOWNLOADED');
  };

  it('downloads every file into the readable layout, smallest first, with its SHA-256', async () => {
    const fake = createFakeTelegramApi();
    const files = new FakeFiles(fake.api);
    await localLocation(prisma, root);
    await saveDownloadSettings(prisma, { concurrency: 1 });
    const channel = await lessons();
    const sizes = [3 * MIB + 5, 10_000, 700_000];
    const archived = await archiveFiles(prisma, channel, [
      { messageId: 11, size: sizes[0]! },
      { messageId: 12, size: sizes[1]! },
      {
        messageId: 13,
        size: sizes[2]!,
        fileName: null,
        type: MediaType.PHOTO,
        mimeType: 'image/jpeg',
      },
    ]);
    const contents = archived.map((file, index) => files.add(file.fileUniqueId, sizes[index]!));
    await boot(fake);

    await until(async () => {
      expect(await prisma.media.count({ where: { downloadStatus: 'DOWNLOADED' } })).toBe(3);
    });
    expect(files.downloads.map((download) => download.fileUniqueId)).toEqual([
      'file-12',
      'file-13',
      'file-11',
    ]);
    const names = ['11 - lesson-11.mp4', '12 - lesson-12.mp4', '13.jpg'];
    for (const [index, file] of archived.entries()) {
      const media = await mediaOf(file.mediaId);
      expect(media.storageKey).toBe(`${FOLDER}/${MONTH}/${names[index]}`);
      expect(media.checksum).toBe(sha256(contents[index]!));
      expect(media).toMatchObject({
        downloadProgress: 100,
        downloadedBytes: BigInt(sizes[index]!),
        error: null,
      });
      expect(
        (await readFile(path.join(root, FOLDER, MONTH, names[index]!))).equals(contents[index]!),
      ).toBe(true);
      expect(await jobOf(file.downloadJobId)).toMatchObject({
        status: 'COMPLETED',
        progress: 100,
        attempts: 0,
      });
    }
    // Nothing left behind in the location's staging folder; the channel's folder is fixed now.
    expect(await readdir(path.join(root, '.tam-tmp'))).toEqual([]);
    expect(await prisma.channel.findUniqueOrThrow({ where: { id: channel.id } })).toMatchObject({
      storageFolder: FOLDER,
    });
  });

  it('leaves channels with automatic downloads off alone, except files someone asked for', async () => {
    const fake = createFakeTelegramApi();
    const files = new FakeFiles(fake.api);
    await localLocation(prisma, root);
    const archived = await archiveFiles(prisma, await lessons({ downloadMedia: false }), [
      { messageId: 1, size: 1_000 },
      { messageId: 2, size: 2_000 },
    ]);
    files.add(archived[0]!.fileUniqueId, 1_000);
    files.add(archived[1]!.fileUniqueId, 2_000);
    await boot(fake);
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(files.downloads).toEqual([]);

    await prisma.downloadJob.update({
      where: { id: archived[1]!.downloadJobId },
      data: { requestedAt: new Date() },
    });
    await until(downloaded(archived[1]!.mediaId));
    expect((await mediaOf(archived[0]!.mediaId)).downloadStatus).toBe('PENDING');
    expect(files.downloads.map((download) => download.fileUniqueId)).toEqual([
      archived[1]!.fileUniqueId,
    ]);
  });

  it('resumes a broken download at the last whole MiB and counts the failed try', async () => {
    const fake = createFakeTelegramApi();
    const files = new FakeFiles(fake.api);
    await localLocation(prisma, root);
    const [file] = await archiveFiles(prisma, await lessons(), [
      { messageId: 21, size: 3 * MIB + 100 },
    ]);
    const content = files.add(file!.fileUniqueId, 3 * MIB + 100);
    files.failNext(file!.fileUniqueId, new Error('connection reset'), 1.5 * MIB);
    await boot(fake);

    await until(downloaded(file!.mediaId));
    expect(files.downloads.map((download) => download.offset)).toEqual([0, MIB]);
    expect(await jobOf(file!.downloadJobId)).toMatchObject({ status: 'COMPLETED', attempts: 1 });
    expect(
      (await readFile(path.join(root, FOLDER, MONTH, '21 - lesson-21.mp4'))).equals(content),
    ).toBe(true);
  });

  it('waits for Telegram without using a try', async () => {
    const fake = createFakeTelegramApi();
    const files = new FakeFiles(fake.api);
    await localLocation(prisma, root);
    const [file] = await archiveFiles(prisma, await lessons(), [{ messageId: 22, size: 5_000 }]);
    files.add(file!.fileUniqueId, 5_000);
    files.failNext(file!.fileUniqueId, new FloodWaitError(1));
    await boot(fake);

    await until(downloaded(file!.mediaId));
    expect(files.downloads).toHaveLength(2);
    expect(await jobOf(file!.downloadJobId)).toMatchObject({ status: 'COMPLETED', attempts: 0 });
  });

  it('skips files whose message is gone from Telegram', async () => {
    const fake = createFakeTelegramApi();
    new FakeFiles(fake.api);
    await localLocation(prisma, root);
    const [file] = await archiveFiles(prisma, await lessons(), [{ messageId: 23, size: 5_000 }]);
    await boot(fake);

    await until(async () => {
      expect(await jobOf(file!.downloadJobId)).toMatchObject({
        status: 'SKIPPED',
        reason: 'NOT_AVAILABLE',
        error: 'The message was deleted on Telegram',
      });
    });
    expect((await mediaOf(file!.mediaId)).downloadStatus).toBe('SKIPPED');
  });

  it('counts each file that ends in its import job, exactly as a recount would', async () => {
    const fake = createFakeTelegramApi();
    const files = new FakeFiles(fake.api);
    await localLocation(prisma, root);
    const channel = await lessons();
    const job = await prisma.importJob.create({
      data: { channelId: channel.id, status: 'COMPLETED', phase: 'DONE' },
    });
    const [done, failed] = await archiveFiles(
      prisma,
      channel,
      [
        { messageId: 31, size: 4_000 },
        { messageId: 32, size: 6_000 },
        { messageId: 33, size: 8_000 },
      ],
      job.id,
    );
    // The importer leaves the counters recounted; from then on each ending file adds itself.
    await prisma.$transaction((tx) => refreshMediaCounters(tx, job.id));
    files.add(done!.fileUniqueId, 4_000);
    files.add(failed!.fileUniqueId, 6_000);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      files.failNext(failed!.fileUniqueId, new Error('boom'));
    }
    // The third file is not on Telegram any more: skipped.
    await boot(fake);

    await until(async () => {
      const statuses = await prisma.downloadJob.findMany({
        where: { importJobId: job.id },
        orderBy: { size: 'asc' },
        select: { status: true },
      });
      expect(statuses.map((row) => row.status)).toEqual(['COMPLETED', 'FAILED', 'SKIPPED']);
    });
    const counters = {
      totalMedia: 3,
      downloadedFiles: 1,
      failedFiles: 1,
      skippedFiles: 1,
      totalBytes: 18_000n,
      downloadedBytes: 4_000n,
    };
    expect(await prisma.importJob.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject(
      counters,
    );
    await prisma.$transaction((tx) => refreshMediaCounters(tx, job.id));
    expect(await prisma.importJob.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject(
      counters,
    );
  });

  it('gives up after the last try, and downloads again when someone asks', async () => {
    const fake = createFakeTelegramApi();
    const files = new FakeFiles(fake.api);
    await localLocation(prisma, root);
    const [file] = await archiveFiles(prisma, await lessons(), [{ messageId: 24, size: 5_000 }]);
    files.add(file!.fileUniqueId, 5_000);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      files.failNext(file!.fileUniqueId, new Error('boom'));
    }
    await boot(fake);

    await until(async () => {
      expect(await jobOf(file!.downloadJobId)).toMatchObject({
        status: 'FAILED',
        attempts: 3,
        error: 'boom',
      });
    });
    expect(await mediaOf(file!.mediaId)).toMatchObject({ downloadStatus: 'FAILED', error: 'boom' });

    // What POST /api/media/:id/download does.
    await prisma.$transaction([
      prisma.downloadJob.update({
        where: { id: file!.downloadJobId },
        data: {
          status: 'PENDING',
          requestedAt: new Date(),
          attempts: 0,
          error: null,
          notBefore: null,
        },
      }),
      prisma.media.update({
        where: { id: file!.mediaId },
        data: { downloadStatus: 'PENDING', error: null },
      }),
    ]);
    await until(downloaded(file!.mediaId));
  });

  it('pauses a full location without using tries', async () => {
    const fake = createFakeTelegramApi();
    const files = new FakeFiles(fake.api);
    const location = await localLocation(prisma, root);
    const [file] = await archiveFiles(prisma, await lessons(), [{ messageId: 25, size: 5_000 }]);
    files.add(file!.fileUniqueId, 5_000);
    await boot(fake, { minFreeBytes: Number.MAX_SAFE_INTEGER });

    // The location is paused first, then the file goes back in line: wait for both.
    await until(async () => {
      expect(
        (await prisma.storageLocation.findUniqueOrThrow({ where: { id: location.id } }))
          .unavailableUntil,
      ).not.toBeNull();
      expect(await jobOf(file!.downloadJobId)).toMatchObject({ status: 'PENDING', attempts: 0 });
    });
    const paused = await prisma.storageLocation.findUniqueOrThrow({ where: { id: location.id } });
    expect(paused.lastError).toMatch(/Not enough free space in "This computer"/);
    expect((await jobOf(file!.downloadJobId)).notBefore).not.toBeNull();
    expect(files.downloads).toEqual([]);
  });

  it('copies a file already stored for another message instead of downloading it again', async () => {
    const fake = createFakeTelegramApi();
    const files = new FakeFiles(fake.api);
    await localLocation(prisma, root);
    await saveDownloadSettings(prisma, { concurrency: 1 });
    const archived = await archiveFiles(prisma, await lessons(), [
      { messageId: 31, size: 50_000, fileUniqueId: 'shared' },
      { messageId: 32, size: 50_000, fileUniqueId: 'shared' },
    ]);
    const content = files.add('shared', 50_000);
    await boot(fake);

    await until(async () => {
      expect(await prisma.media.count({ where: { downloadStatus: 'DOWNLOADED' } })).toBe(2);
    });
    expect(files.downloads).toHaveLength(1);
    for (const name of ['31 - lesson-31.mp4', '32 - lesson-32.mp4']) {
      expect((await readFile(path.join(root, FOLDER, MONTH, name))).equals(content)).toBe(true);
    }
    const [first, second] = await Promise.all(archived.map((file) => mediaOf(file.mediaId)));
    expect(first!.checksum).toBe(second!.checksum);
  });

  it('stops when downloads are paused and goes on from its partial file', async () => {
    const fake = createFakeTelegramApi();
    const files = new FakeFiles(fake.api);
    await localLocation(prisma, root);
    const [file] = await archiveFiles(prisma, await lessons(), [{ messageId: 26, size: 3 * MIB }]);
    const content = files.add(file!.fileUniqueId, 3 * MIB);
    const hold = files.hold(file!.fileUniqueId, 1.25 * MIB);
    await boot(fake);
    await hold.reached;

    // What PATCH /api/settings { downloads: { paused: true } } does.
    await saveDownloadSettings(prisma, { paused: true });
    await prisma.downloadJob.updateMany({
      where: { status: 'ACTIVE' },
      data: { status: 'PENDING' },
    });
    await prisma.media.updateMany({
      where: { downloadStatus: 'DOWNLOADING' },
      data: { downloadStatus: 'PENDING' },
    });
    hold.release();

    const part = path.join(root, '.tam-tmp', `${file!.mediaId}.part`);
    await until(async () => {
      expect((await stat(part)).size).toBeGreaterThanOrEqual(1.25 * MIB);
      expect(await jobOf(file!.downloadJobId)).toMatchObject({ status: 'PENDING', attempts: 0 });
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(files.downloads).toHaveLength(1);

    await saveDownloadSettings(prisma, { paused: false });
    await until(downloaded(file!.mediaId));
    expect(files.downloads.map((download) => download.offset)).toEqual([0, MIB]);
    expect(
      (await readFile(path.join(root, FOLDER, MONTH, '26 - lesson-26.mp4'))).equals(content),
    ).toBe(true);
  });

  it('never picks up a paused download again, even while the worker still has the old settings', async () => {
    const fake = createFakeTelegramApi();
    const files = new FakeFiles(fake.api);
    await localLocation(prisma, root);
    const [file] = await archiveFiles(prisma, await lessons(), [{ messageId: 27, size: 3 * MIB }]);
    files.add(file!.fileUniqueId, 3 * MIB);
    const hold = files.hold(file!.fileUniqueId, 1.25 * MIB);
    // The worker keeps reading its cached "not paused" settings for a minute.
    await boot(fake, { settingsCacheMs: 60_000 });
    await hold.reached;

    await saveDownloadSettings(prisma, { paused: true });
    await prisma.downloadJob.updateMany({
      where: { status: 'ACTIVE' },
      data: { status: 'PENDING' },
    });
    await prisma.media.updateMany({
      where: { downloadStatus: 'DOWNLOADING' },
      data: { downloadStatus: 'PENDING' },
    });
    hold.release();

    await new Promise((resolve) => setTimeout(resolve, 1_000));
    expect(await jobOf(file!.downloadJobId)).toMatchObject({
      status: 'PENDING',
      runSeq: 1,
      attempts: 0,
    });
    expect(files.downloads).toHaveLength(1);
  });

  it('uploads to Google Drive from the staging folder', async () => {
    const google = await FakeGoogle.start();
    try {
      const drivers = new LocationDriverFactory({
        secrets: SecretBox.fromBase64(randomBytes(32).toString('base64')),
        google: { clientId: google.clientId, clientSecret: google.clientSecret },
        googleUnavailableReason: null,
        endpoints: google.endpoints,
        driveOptions: {
          sleep: () => Promise.resolve(),
          chunkBytes: 256 * 1024,
          multipartMaxBytes: 300 * 1024,
        },
      });
      // What connecting Google Drive in the api leaves behind: the top folder and a sealed token.
      const refreshToken = google.issueRefreshToken();
      const top = await ensureTopFolder(
        drivers.driveApi(new GoogleAccessTokens(drivers.oauth(), refreshToken)),
        DRIVE_TOP,
      );
      const location = await prisma.storageLocation.create({
        data: {
          kind: 'GOOGLE_DRIVE',
          name: 'Drive',
          displayPath: `My Drive › ${DRIVE_TOP}`,
          target: top.id,
          config: { folderId: top.id, folderName: DRIVE_TOP, accountEmail: null },
          isDefault: true,
        },
      });
      await prisma.storageLocation.update({
        where: { id: location.id },
        data: { secretEnc: drivers.seal(location.id, refreshToken) },
      });

      const fake = createFakeTelegramApi();
      const files = new FakeFiles(fake.api);
      const [file] = await archiveFiles(prisma, await lessons(), [
        { messageId: 41, size: MIB + 7 },
      ]);
      const content = files.add(file!.fileUniqueId, MIB + 7);
      const staging = path.join(base, 'staging');
      await boot(fake, { stagingDir: staging }, drivers);

      await until(downloaded(file!.mediaId));
      expect(await mediaOf(file!.mediaId)).toMatchObject({
        storageLocationId: location.id,
        storageKey: `${FOLDER}/${MONTH}/41 - lesson-41.mp4`,
        checksum: sha256(content),
      });
      expect(
        google.fileAt(DRIVE_TOP, FOLDER, MONTH, '41 - lesson-41.mp4')?.content.equals(content),
      ).toBe(true);
      expect(await readdir(staging)).toEqual([]);
    } finally {
      await google.close();
    }
  });

  it('keeps Telegram previews in the thumbnail cache, downloaded or not', async () => {
    const fake = createFakeTelegramApi();
    const files = new FakeFiles(fake.api);
    await localLocation(prisma, root);
    const [withPreview, withoutPreview] = await archiveFiles(
      prisma,
      await lessons({ downloadMedia: false }),
      [
        { messageId: 51, size: 5_000 },
        { messageId: 52, size: 5_000 },
      ],
    );
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), randomBytes(500)]);
    files.preview(withPreview!.fileUniqueId, jpeg);
    files.preview(withoutPreview!.fileUniqueId, null);
    const thumbnails = path.join(base, 'thumbnails');
    await boot(fake, { thumbnailDir: thumbnails, thumbnailIntervalMs: 50 });

    await until(async () => {
      expect(await prisma.media.count({ where: { thumbnailCheckedAt: null } })).toBe(0);
    });
    const key = thumbnailKey(withPreview!.mediaId, 'jpg');
    expect((await mediaOf(withPreview!.mediaId)).thumbnailKey).toBe(key);
    expect((await readFile(path.join(thumbnails, ...key.split('/')))).equals(jpeg)).toBe(true);
    expect((await mediaOf(withoutPreview!.mediaId)).thumbnailKey).toBeNull();
    expect(files.downloads).toEqual([]);
  });

  it('puts back in line a try whose queue job vanished', async () => {
    const fake = createFakeTelegramApi();
    await localLocation(prisma, root);
    const [file] = await archiveFiles(prisma, await lessons({ downloadMedia: false }), [
      { messageId: 61, size: 5_000 },
    ]);
    await prisma.$executeRaw`
      UPDATE download_jobs SET status = 'ACTIVE', run_seq = 1, updated_at = now() - interval '10 minutes'
      WHERE id = ${file!.downloadJobId}::uuid`;
    const context = await boot(fake, { lostAfterMs: 1_000, schedulerIntervalMs: 3_600_000 });
    await context.get(DownloadReconciler).idle();

    expect(await jobOf(file!.downloadJobId)).toMatchObject({ status: 'PENDING', attempts: 0 });
    expect((await jobOf(file!.downloadJobId)).error).toMatch(/interrupted/);
  });

  it('stops downloading a chat that turned protected', async () => {
    const fake = createFakeTelegramApi();
    const files = new FakeFiles(fake.api);
    await localLocation(prisma, root);
    await saveDownloadSettings(prisma, { concurrency: 1 });
    const channel = await lessons();
    const archived = await archiveFiles(prisma, channel, [
      { messageId: 71, size: 1_000 },
      { messageId: 72, size: 2_000 },
    ]);
    files.add(archived[0]!.fileUniqueId, 1_000);
    files.add(archived[1]!.fileUniqueId, 2_000);
    files.failNext(archived[0]!.fileUniqueId, new ChatProtectedError(CHAT_ID));
    await boot(fake);

    await until(async () => {
      expect(
        await prisma.downloadJob.count({ where: { status: 'SKIPPED', reason: 'PROTECTED' } }),
      ).toBe(2);
    });
    expect(await prisma.media.count({ where: { downloadStatus: 'SKIPPED' } })).toBe(2);
    expect(await prisma.channel.findUniqueOrThrow({ where: { id: channel.id } })).toMatchObject({
      isProtected: true,
      downloadMedia: false,
    });
  });
});
