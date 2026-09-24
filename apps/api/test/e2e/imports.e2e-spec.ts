import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Channel, PrismaClient } from '@tam/database';
import {
  type ImportJobData,
  type ImportJobDto,
  type JobStatus,
  type Page,
  QUEUES,
  TELEGRAM_ACCOUNT_KEY,
  jobIds,
} from '@tam/shared';
import { Queue } from 'bullmq';
import request from 'supertest';
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
import { ImportQueue } from '../../src/imports/import-queue.js';
import { createTestPrisma, insertUser } from './support/database.js';
import { expectApiError, nextClientIp, sessionCookie } from './support/http.js';
import { createTestApp } from './support/test-app.js';

const EMAIL = 'importer@example.test';
const PASSWORD = 'correct horse battery staple';

describe('import endpoints (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let cookie: string;
  /** The queue as the worker sees it (the e2e environment's prefix and Redis database). */
  const queue = new Queue<ImportJobData>(QUEUES.telegramImport, {
    connection: { url: inject('redisUrl') },
    prefix: 'tamtest',
  });

  const http = () => request(app.getHttpServer());
  const get = (path: string) => http().get(path).set('Cookie', cookie);
  const post = (path: string, body?: object) =>
    http().post(path).set('Cookie', cookie).set('X-Forwarded-For', nextClientIp()).send(body);

  beforeAll(async () => {
    prisma = createTestPrisma();
    await prisma.$executeRaw`TRUNCATE TABLE users, sessions CASCADE`;
    await insertUser(prisma, EMAIL, PASSWORD);
    app = await createTestApp();
    const login = await http()
      .post('/api/auth/login')
      .set('X-Forwarded-For', nextClientIp())
      .send({ email: EMAIL, password: PASSWORD })
      .expect(200);
    cookie = sessionCookie(login);
  });

  beforeEach(async () => {
    await prisma.$executeRaw`
      TRUNCATE TABLE telegram_accounts, channels, messages, media, import_jobs, download_jobs CASCADE`;
    await prisma.telegramAccount.create({
      data: { accountKey: TELEGRAM_ACCOUNT_KEY, authState: 'READY' },
    });
    await queue.obliterate({ force: true });
  });

  afterEach(() => vi.restoreAllMocks());

  afterAll(async () => {
    await queue.obliterate({ force: true });
    await queue.close();
    await app.close();
    await prisma.$disconnect();
  });

  let chatSequence = 0;
  async function addChannel(data: Partial<Channel> = {}): Promise<Channel> {
    chatSequence += 1;
    return prisma.channel.create({
      data: {
        telegramChatId: BigInt(-1_001_000_000_000 - chatSequence),
        title: `Lessons ${chatSequence}`,
        username: `lessons_${chatSequence}`,
        type: 'CHANNEL',
        ...data,
      },
    });
  }

  it.each([
    ['post', `/api/channels/${randomUUID()}/import`],
    ['get', '/api/import-jobs'],
    ['get', `/api/import-jobs/${randomUUID()}`],
    ['post', `/api/import-jobs/${randomUUID()}/pause`],
    ['post', `/api/import-jobs/${randomUUID()}/resume`],
    ['post', `/api/import-jobs/${randomUUID()}/cancel`],
  ] as const)('%s %s requires a session', async (method, path) => {
    expectApiError(await http()[method](path), 401, 'UNAUTHENTICATED');
  });

  describe('POST /api/channels/:id/import', () => {
    it('saves the job and queues its first run for the worker', async () => {
      const channel = await addChannel({ title: 'Physics' });
      const response = await post(`/api/channels/${channel.id}/import`, { mode: 'ALL' }).expect(
        202,
      );
      const job = response.body as ImportJobDto;
      expect(job).toMatchObject({
        channelId: channel.id,
        channel: {
          id: channel.id,
          telegramChatId: channel.telegramChatId.toString(),
          title: 'Physics',
          username: channel.username,
          type: 'CHANNEL',
        },
        type: 'IMPORT',
        mode: 'ALL',
        fromDate: null,
        status: 'PENDING',
        phase: 'HISTORY',
        totalMessages: null,
        processedMessages: 0,
        totalMedia: 0,
        totalBytes: 0,
        statusDetail: null,
        error: null,
        startedAt: null,
        completedAt: null,
      });

      const run = await queue.getJob(jobIds.importRun(job.id, 1));
      expect(run?.data).toEqual({ importJobId: job.id, runSeq: 1 });
      expect(run?.opts).toMatchObject({
        attempts: 5,
        backoff: { type: 'exponential', delay: 30_000 },
      });
      const stored = await prisma.importJob.findUniqueOrThrow({ where: { id: job.id } });
      expect(stored).toMatchObject({ runSeq: 1, bullJobId: jobIds.importRun(job.id, 1) });
    });

    it('returns the unfinished job for the same request, and refuses a different one', async () => {
      const channel = await addChannel();
      const first = await post(`/api/channels/${channel.id}/import`, {
        mode: 'FROM_DATE',
        fromDate: '2026-09-01T00:00:00+07:00',
      }).expect(202);
      expect((first.body as ImportJobDto).fromDate).toBe('2026-08-31T17:00:00.000Z');

      // The same moment written differently is the same import.
      const again = await post(`/api/channels/${channel.id}/import`, {
        mode: 'FROM_DATE',
        fromDate: '2026-08-31T17:00:00Z',
      }).expect(200);
      expect((again.body as ImportJobDto).id).toBe((first.body as ImportJobDto).id);

      const other = expectApiError(
        await post(`/api/channels/${channel.id}/import`, { mode: 'ALL' }),
        409,
        'IMPORT_ACTIVE',
      );
      expect(other.details).toEqual({ jobId: (first.body as ImportJobDto).id });
      expect(await prisma.importJob.count()).toBe(1);
    });

    it('creates one job when the same import is requested concurrently', async () => {
      const channel = await addChannel();
      const responses = await Promise.all(
        Array.from({ length: 5 }, () =>
          post(`/api/channels/${channel.id}/import`, { mode: 'ALL' }),
        ),
      );
      expect(responses.map((response) => response.status).sort()).toEqual([
        200, 200, 200, 200, 202,
      ]);
      expect(new Set(responses.map((response) => (response.body as ImportJobDto).id)).size).toBe(1);
      expect(await prisma.importJob.count()).toBe(1);
    });

    it('validates the request', async () => {
      const channel = await addChannel();
      const future = new Date(Date.now() + 7 * 24 * 60 * 60_000).toISOString();
      const tooLate = expectApiError(
        await post(`/api/channels/${channel.id}/import`, { mode: 'FROM_DATE', fromDate: future }),
        400,
        'VALIDATION_FAILED',
      );
      expect(tooLate.details).toEqual([
        { path: 'fromDate', message: 'Pick a date that is not in the future' },
      ]);
      expectApiError(
        await post(`/api/channels/${channel.id}/import`, {}),
        400,
        'VALIDATION_FAILED',
      );
      expectApiError(
        await post('/api/channels/not-a-uuid/import', { mode: 'ALL' }),
        400,
        'VALIDATION_FAILED',
      );
      expectApiError(
        await post(`/api/channels/${randomUUID()}/import`, { mode: 'ALL' }),
        404,
        'NOT_FOUND',
      );
    });

    it('refuses protected chats, old groups of upgraded supergroups and a logged-out Telegram', async () => {
      const protectedChannel = await addChannel({ isProtected: true });
      expectApiError(
        await post(`/api/channels/${protectedChannel.id}/import`, { mode: 'ALL' }),
        422,
        'CHAT_PROTECTED',
      );
      const supergroup = await addChannel({ type: 'SUPERGROUP' });
      const oldGroup = await addChannel({ type: 'GROUP', migratedToChannelId: supergroup.id });
      expectApiError(
        await post(`/api/channels/${oldGroup.id}/import`, { mode: 'ALL' }),
        422,
        'CHANNEL_MIGRATED',
      );

      await prisma.telegramAccount.update({
        where: { accountKey: TELEGRAM_ACCOUNT_KEY },
        data: { authState: 'LOGGED_OUT' },
      });
      expectApiError(
        await post(`/api/channels/${supergroup.id}/import`, { mode: 'ALL' }),
        409,
        'TELEGRAM_NOT_READY',
      );
      expect(await prisma.importJob.count()).toBe(0);
    });

    it('still saves the job when Redis does not take the run in time', async () => {
      const channel = await addChannel();
      const producer = Reflect.get(app.get(ImportQueue), 'queue') as Queue;
      vi.spyOn(producer, 'add').mockReturnValue(new Promise(() => undefined));

      const response = await post(`/api/channels/${channel.id}/import`, { mode: 'ALL' }).expect(
        202,
      );
      const job = response.body as ImportJobDto;
      expect(job.status).toBe('PENDING');
      // The worker's reconciler queues it later.
      expect(await queue.getJob(jobIds.importRun(job.id, 1))).toBeUndefined();
    });
  });

  describe('pause, resume and cancel', () => {
    async function started(): Promise<ImportJobDto> {
      const channel = await addChannel();
      return (await post(`/api/channels/${channel.id}/import`, { mode: 'ALL' }).expect(202))
        .body as ImportJobDto;
    }

    it('moves through the states one compare-and-set at a time', async () => {
      const job = await started();

      const paused = await post(`/api/import-jobs/${job.id}/pause`).expect(200);
      expect(paused.body).toMatchObject({ id: job.id, status: 'PAUSED' });
      // The run that never started is dropped from the queue.
      expect(await queue.getJob(jobIds.importRun(job.id, 1))).toBeUndefined();
      const pausedAgain = expectApiError(
        await post(`/api/import-jobs/${job.id}/pause`),
        409,
        'INVALID_JOB_STATE',
      );
      expect(pausedAgain.details).toEqual({ status: 'PAUSED' });

      const resumed = await post(`/api/import-jobs/${job.id}/resume`).expect(202);
      expect(resumed.body).toMatchObject({ status: 'PENDING', statusDetail: null, error: null });
      const run = await queue.getJob(jobIds.importRun(job.id, 2));
      expect(run?.data).toEqual({ importJobId: job.id, runSeq: 2 });
      expectApiError(await post(`/api/import-jobs/${job.id}/resume`), 409, 'INVALID_JOB_STATE');

      const cancelled = await post(`/api/import-jobs/${job.id}/cancel`).expect(200);
      expect(cancelled.body).toMatchObject({ status: 'CANCELLED' });
      expect((cancelled.body as ImportJobDto).completedAt).not.toBeNull();
      expect(await queue.getJob(jobIds.importRun(job.id, 2))).toBeUndefined();
      expectApiError(await post(`/api/import-jobs/${job.id}/cancel`), 409, 'INVALID_JOB_STATE');
      expectApiError(await post(`/api/import-jobs/${job.id}/pause`), 409, 'INVALID_JOB_STATE');

      // The channel is free for a new import.
      const next = await post(`/api/channels/${job.channelId}/import`, { mode: 'ALL' }).expect(202);
      expect((next.body as ImportJobDto).id).not.toBe(job.id);
    });

    it('lets a running job be paused, and answers 404 for unknown jobs', async () => {
      const job = await started();
      await prisma.importJob.update({
        where: { id: job.id },
        data: { status: 'RUNNING', statusDetail: 'Waiting' },
      });
      const paused = await post(`/api/import-jobs/${job.id}/pause`).expect(200);
      expect(paused.body).toMatchObject({ status: 'PAUSED', statusDetail: null });

      for (const action of ['pause', 'resume', 'cancel']) {
        expectApiError(await post(`/api/import-jobs/${randomUUID()}/${action}`), 404, 'NOT_FOUND');
      }
    });

    it('cancels the downloads of the job that have not started', async () => {
      const job = await started();
      const message = await prisma.message.create({
        data: {
          channelId: job.channelId,
          telegramMessageId: 1,
          type: 'PHOTO',
          telegramDate: new Date(),
        },
      });
      const [waiting, done] = await Promise.all(
        ['a', 'b'].map((unique) =>
          prisma.media.create({
            data: {
              messageId: message.id,
              telegramFileId: `-100:1:${unique}`,
              telegramFileUniqueId: unique,
              type: 'PHOTO',
            },
          }),
        ),
      );
      await prisma.downloadJob.create({ data: { mediaId: waiting.id, importJobId: job.id } });
      await prisma.media.update({ where: { id: done.id }, data: { downloadStatus: 'DOWNLOADED' } });
      await prisma.downloadJob.create({
        data: { mediaId: done.id, importJobId: job.id, status: 'COMPLETED' },
      });

      await post(`/api/import-jobs/${job.id}/cancel`).expect(200);

      const media = await prisma.media.findMany({
        include: { downloadJob: true },
        orderBy: { telegramFileUniqueId: 'asc' },
      });
      expect(media.map((item) => [item.downloadStatus, item.downloadJob?.status])).toEqual([
        ['CANCELLED', 'CANCELLED'],
        ['DOWNLOADED', 'COMPLETED'],
      ]);
    });
  });

  describe('GET /api/import-jobs', () => {
    it('lists newest first, filters by channel and status, and pages with a cursor', async () => {
      const physics = await addChannel({ title: 'Physics' });
      const history = await addChannel({ title: 'History' });
      const base = Date.UTC(2026, 8, 1);
      const seed: [Channel, JobStatus][] = [
        [physics, 'COMPLETED'],
        [physics, 'FAILED'],
        [history, 'CANCELLED'],
        [history, 'RUNNING'],
      ];
      const rows = await Promise.all(
        seed.map(([channel, status], minutes) =>
          prisma.importJob.create({
            data: {
              channelId: channel.id,
              status,
              createdAt: new Date(base + minutes * 60_000),
              totalBytes: 5n * 1024n ** 3n,
            },
          }),
        ),
      );
      const [completed, failed, cancelled, running] = rows.map((row) => row.id);

      const first = (await get('/api/import-jobs?limit=3').expect(200)).body as Page<ImportJobDto>;
      expect(first.items.map((item) => item.id)).toEqual([running, cancelled, failed]);
      expect(first.items[0]).toMatchObject({
        channel: { title: 'History' },
        totalBytes: 5 * 1024 ** 3,
      });
      expect(first.nextCursor).toEqual(expect.any(String));
      const second = (await get(`/api/import-jobs?limit=3&cursor=${first.nextCursor}`).expect(200))
        .body as Page<ImportJobDto>;
      expect(second).toEqual({
        items: [expect.objectContaining({ id: completed })],
        nextCursor: null,
      });

      const ofPhysics = (await get(`/api/import-jobs?channelId=${physics.id}`).expect(200))
        .body as Page<ImportJobDto>;
      expect(ofPhysics.items.map((item) => item.id)).toEqual([failed, completed]);
      const ended = (await get('/api/import-jobs?status=COMPLETED,CANCELLED').expect(200))
        .body as Page<ImportJobDto>;
      expect(ended.items.map((item) => item.id)).toEqual([cancelled, completed]);

      expectApiError(await get('/api/import-jobs?status=STUCK'), 400, 'VALIDATION_FAILED');
      expectApiError(await get('/api/import-jobs?cursor=bogus'), 400, 'INVALID_CURSOR');
    });

    it('GET /api/import-jobs/:id returns one job, 404 for an unknown id', async () => {
      const channel = await addChannel();
      const job = await prisma.importJob.create({
        data: {
          channelId: channel.id,
          status: 'RUNNING',
          totalMessages: 500,
          processedMessages: 120,
          totalMedia: 12,
          totalBytes: 123_456n,
          statusDetail: 'Telegram asked to wait 45 s before reading more',
        },
      });
      const response = await get(`/api/import-jobs/${job.id}`).expect(200);
      expect(response.body).toMatchObject({
        id: job.id,
        status: 'RUNNING',
        totalMessages: 500,
        processedMessages: 120,
        totalMedia: 12,
        totalBytes: 123_456,
        statusDetail: 'Telegram asked to wait 45 s before reading more',
      });
      expectApiError(await get(`/api/import-jobs/${randomUUID()}`), 404, 'NOT_FOUND');
      expectApiError(await get('/api/import-jobs/not-a-uuid'), 400, 'VALIDATION_FAILED');
    });
  });
});
