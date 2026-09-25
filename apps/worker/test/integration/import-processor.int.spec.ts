import { getQueueToken } from '@nestjs/bullmq';
import { Test, type TestingModule } from '@nestjs/testing';
import type { PrismaService } from '@tam/database/nest';
import {
  IMPORT_RUN_JOB_NAME,
  type ImportJobData,
  QUEUES,
  importRunJobOptions,
  jobIds,
} from '@tam/shared';
import { FloodWaitError } from '@tam/telegram';
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
import { ImportReconciler } from '../../src/imports/import-reconciler.js';
import { IMPORT_SETTINGS, type ImportSettings } from '../../src/imports/import-settings.js';
import { MEDIA_SETTINGS } from '../../src/media/media-settings.js';
import { WAITING_DETAILS } from '../../src/imports/import.processor.js';
import { ShutdownCoordinator } from '../../src/shutdown/index.js';
import { ACCOUNT_KEY } from '../../src/telegram/telegram-auth.service.js';
import {
  TELEGRAM_API_PROVIDER,
  TelegramUnavailableError,
} from '../../src/telegram/telegram.tokens.js';
import { WorkerModule } from '../../src/worker.module.js';
import { FakeChats, chatInfo, history } from './support/fake-chats.js';
import { IDLE_MEDIA_SETTINGS } from './support/media-fixtures.js';
import {
  createFakeTelegramApi,
  resetTelegramTables,
  testPrisma,
} from './support/telegram-fixtures.js';
import { TEST_BULLMQ_PREFIX } from './test-env.js';

const CHAT_ID = '-1001000000002';
const OTHER_CHAT_ID = '-1001000000003';
const FAST: ImportSettings = {
  pageDelayMs: 0,
  unavailableRetryMs: 200,
  reconcileIntervalMs: 3_600_000,
};

describe('import jobs through the queue', () => {
  let prisma: PrismaService;
  /** Reads the queue from outside the application, which closes during some tests. */
  const inspector = new Queue<ImportJobData>(QUEUES.telegramImport, {
    connection: { url: inject('redisUrl') },
    prefix: TEST_BULLMQ_PREFIX,
  });
  let app: TestingModule | undefined;

  beforeAll(() => {
    prisma = testPrisma();
  });
  beforeEach(async () => {
    await resetTelegramTables(prisma);
    await prisma.telegramAccount.create({ data: { accountKey: ACCOUNT_KEY, authState: 'READY' } });
  });
  afterEach(async () => {
    await app?.close();
    app = undefined;
    await inspector.obliterate({ force: true });
  });
  afterAll(async () => {
    await inspector.close();
    await resetTelegramTables(prisma);
    await prisma.$disconnect();
  });

  async function boot(
    fake: ReturnType<typeof createFakeTelegramApi>,
    settings = FAST,
  ): Promise<TestingModule> {
    const moduleRef = await Test.createTestingModule({ imports: [WorkerModule] })
      .overrideProvider(TELEGRAM_API_PROVIDER)
      .useValue(fake.provider)
      .overrideProvider(IMPORT_SETTINGS)
      .useValue(settings)
      // Imported media stay PENDING here: downloads have tests of their own.
      .overrideProvider(MEDIA_SETTINGS)
      .useValue(IDLE_MEDIA_SETTINGS)
      .setLogger({ log() {}, error() {}, warn() {}, debug() {}, verbose() {}, fatal() {} })
      .compile();
    await moduleRef.init();
    app = moduleRef;
    // The startup pass of the reconciler queues runs of jobs created before the boot; jobs a
    // test creates afterwards get only the runs the test adds (with its own options).
    await moduleRef.get(ImportReconciler).idle();
    return moduleRef;
  }

  /** A channel with a PENDING import job, as the api creates them. */
  async function queuedJob(chatId = CHAT_ID): Promise<ImportJobData> {
    const channel = await prisma.channel.create({
      data: { telegramChatId: BigInt(chatId), title: 'Lessons', type: 'CHANNEL' },
    });
    const job = await prisma.importJob.create({ data: { channelId: channel.id, runSeq: 1 } });
    return { importJobId: job.id, runSeq: 1 };
  }

  function enqueue(data: ImportJobData, overrides: Record<string, unknown> = {}) {
    return inspector.add(
      IMPORT_RUN_JOB_NAME,
      { importJobId: data.importJobId, runSeq: data.runSeq },
      { ...importRunJobOptions(data.importJobId, data.runSeq), ...overrides },
    );
  }

  const statusOf = async (data: ImportJobData) =>
    (await prisma.importJob.findUniqueOrThrow({ where: { id: data.importJobId } })).status;

  it('runs the import processor, which receives an AbortSignal', async () => {
    const context = await boot(createFakeTelegramApi());
    const workers = context.get(ShutdownCoordinator).workers();
    expect(workers.map((worker) => worker.name)).toEqual([
      QUEUES.telegramImport,
      QUEUES.mediaDownload,
    ]);
    expect(Reflect.get(workers[0]!, 'processorAcceptsSignal')).toBe(true);
    expect(workers[0]!.opts).toMatchObject({ concurrency: 1, maxStalledCount: 10 });
  });

  it('imports a queued job to completion', async () => {
    const fake = createFakeTelegramApi();
    new FakeChats(fake.api).addChat(chatInfo(CHAT_ID), history(CHAT_ID, 150));
    const data = await queuedJob();
    await boot(fake);
    await enqueue(data);

    await vi.waitFor(async () => expect(await statusOf(data)).toBe('COMPLETED'), {
      timeout: 15_000,
      interval: 100,
    });
    expect(await prisma.message.count()).toBe(150);
    // Completed runs leave the queue.
    await vi.waitFor(async () =>
      expect(await inspector.getJob(jobIds.importRun(data.importJobId, 1))).toBeUndefined(),
    );
  });

  it('waits out a Telegram rate limit without using up a try', async () => {
    const fake = createFakeTelegramApi();
    new FakeChats(fake.api).addChat(chatInfo(CHAT_ID), history(CHAT_ID, 30));
    const real = fake.api.getHistoryPage.getMockImplementation();
    fake.api.getHistoryPage.mockImplementationOnce(async () => {
      throw new FloodWaitError(1);
    });
    await boot(fake);
    const data = await queuedJob();
    const run = await enqueue(data, { attempts: 1 });

    await vi.waitFor(
      async () => {
        const job = await prisma.importJob.findUniqueOrThrow({ where: { id: data.importJobId } });
        expect(job.statusDetail).toBe(WAITING_DETAILS.floodWait(1));
        expect(await inspector.getJobState(run.id!)).toBe('delayed');
      },
      { timeout: 10_000, interval: 50 },
    );
    fake.api.getHistoryPage.mockImplementation(real!);

    // One try only, yet the run completes after the wait.
    await vi.waitFor(async () => expect(await statusOf(data)).toBe('COMPLETED'), {
      timeout: 15_000,
      interval: 100,
    });
    const job = await prisma.importJob.findUniqueOrThrow({ where: { id: data.importJobId } });
    expect(job).toMatchObject({ statusDetail: null, processedMessages: 30 });
  });

  it('waits for the Telegram connection, then imports', async () => {
    const fake = createFakeTelegramApi();
    new FakeChats(fake.api).addChat(chatInfo(CHAT_ID), history(CHAT_ID, 20));
    const provider = fake.provider;
    let connected = false;
    // Like TelegramConnection before it has connected (or while it reconnects).
    const offline = {
      get api() {
        if (!connected) {
          throw new TelegramUnavailableError();
        }
        return provider.api;
      },
    };
    const data = await queuedJob();
    await boot({ ...fake, provider: offline });
    await enqueue(data);

    await vi.waitFor(
      async () => {
        const job = await prisma.importJob.findUniqueOrThrow({ where: { id: data.importJobId } });
        expect(job).toMatchObject({ status: 'PENDING', statusDetail: WAITING_DETAILS.unavailable });
      },
      { timeout: 10_000, interval: 50 },
    );
    connected = true;
    await vi.waitFor(async () => expect(await statusOf(data)).toBe('COMPLETED'), {
      timeout: 15_000,
      interval: 100,
    });
  });

  it('marks the job failed after its last try, with the reason', async () => {
    const fake = createFakeTelegramApi();
    new FakeChats(fake.api).addChat(chatInfo(CHAT_ID), history(CHAT_ID, 10));
    fake.api.getHistoryPage.mockRejectedValue(new Error('Telegram is having a bad day'));
    await boot(fake);
    const data = await queuedJob();
    await enqueue(data, { attempts: 1 });

    await vi.waitFor(async () => expect(await statusOf(data)).toBe('FAILED'), {
      timeout: 15_000,
      interval: 100,
    });
    const job = await prisma.importJob.findUniqueOrThrow({ where: { id: data.importJobId } });
    expect(job.error).toBe('The import stopped after 1 tries: Telegram is having a bad day');
    expect(job.completedAt).not.toBeNull();
  });

  it('fails at once when the chat turned protected', async () => {
    const fake = createFakeTelegramApi();
    new FakeChats(fake.api).addChat(chatInfo(CHAT_ID, { isProtected: true }), history(CHAT_ID, 10));
    const data = await queuedJob();
    await boot(fake);
    await enqueue(data);

    await vi.waitFor(async () => expect(await statusOf(data)).toBe('FAILED'), {
      timeout: 15_000,
      interval: 100,
    });
    const job = await prisma.importJob.findUniqueOrThrow({ where: { id: data.importJobId } });
    expect(job.error).toMatch(/Content protection was turned on/);
    expect(await prisma.message.count()).toBe(0);
  });

  it('hands a running import back on shutdown and finishes it after a restart', async () => {
    const fake = createFakeTelegramApi();
    new FakeChats(fake.api).addChat(chatInfo(CHAT_ID), history(CHAT_ID, 1_000));
    const data = await queuedJob();
    await boot(fake, { ...FAST, pageDelayMs: 150 });
    const run = await enqueue(data);

    await vi.waitFor(
      async () => {
        const job = await prisma.importJob.findUniqueOrThrow({ where: { id: data.importJobId } });
        expect(job.processedMessages).toBeGreaterThanOrEqual(200);
      },
      { timeout: 15_000, interval: 20 },
    );
    await app?.close();
    app = undefined;

    // Stopped mid-way: the run waits in the queue, and the job keeps what it stored.
    expect(await inspector.getJobState(run.id!)).toBe('waiting');
    const stopped = await prisma.importJob.findUniqueOrThrow({ where: { id: data.importJobId } });
    expect(stopped.status).toBe('RUNNING');
    expect(stopped.processedMessages).toBeLessThan(1_000);
    expect(await prisma.message.count()).toBe(stopped.processedMessages);

    await boot(fake);
    await vi.waitFor(async () => expect(await statusOf(data)).toBe('COMPLETED'), {
      timeout: 20_000,
      interval: 100,
    });
    const done = await prisma.importJob.findUniqueOrThrow({ where: { id: data.importJobId } });
    expect(done).toMatchObject({ processedMessages: 1_000, totalMessages: 1_000, totalMedia: 100 });
    expect(await prisma.message.count()).toBe(1_000);
    expect(await prisma.media.count()).toBe(100);
    expect(await prisma.downloadJob.count()).toBe(100);
  });

  it('the reconciler queues runs missing from the queue, at startup and later', async () => {
    const fake = createFakeTelegramApi();
    const chats = new FakeChats(fake.api);
    chats.addChat(chatInfo(CHAT_ID), history(CHAT_ID, 10));
    chats.addChat(chatInfo(OTHER_CHAT_ID), history(OTHER_CHAT_ID, 10));
    // The api could not enqueue this job (Redis was down): starting the worker adds its run.
    const first = await queuedJob();
    const context = await boot(fake);
    await vi.waitFor(async () => expect(await statusOf(first)).toBe('COMPLETED'), {
      timeout: 15_000,
      interval: 100,
    });

    const queue = context.get<Queue>(getQueueToken(QUEUES.telegramImport));
    const add = vi.spyOn(queue, 'add');
    const second = await queuedJob(OTHER_CHAT_ID);
    await expect(context.get(ImportReconciler).reconcile()).resolves.toEqual({
      enqueued: 1,
      failed: 0,
    });
    expect(add).toHaveBeenCalledExactlyOnceWith(
      IMPORT_RUN_JOB_NAME,
      second,
      importRunJobOptions(second.importJobId, 1),
    );
    await vi.waitFor(async () => expect(await statusOf(second)).toBe('COMPLETED'), {
      timeout: 15_000,
      interval: 100,
    });
  });

  it('the reconciler records a failure the worker could not record', async () => {
    const fake = createFakeTelegramApi();
    new FakeChats(fake.api).addChat(chatInfo(CHAT_ID), history(CHAT_ID, 10));
    fake.api.getHistoryPage.mockRejectedValue(new Error('flaky network'));
    const context = await boot(fake);
    const data = await queuedJob();
    await enqueue(data, { attempts: 1 });
    await vi.waitFor(async () => expect(await statusOf(data)).toBe('FAILED'), {
      timeout: 15_000,
      interval: 100,
    });

    // As if the worker had died before writing the failure down.
    await prisma.importJob.update({
      where: { id: data.importJobId },
      data: { status: 'RUNNING', error: null },
    });
    await expect(context.get(ImportReconciler).reconcile()).resolves.toEqual({
      enqueued: 0,
      failed: 1,
    });
    const job = await prisma.importJob.findUniqueOrThrow({ where: { id: data.importJobId } });
    expect(job).toMatchObject({
      status: 'FAILED',
      error: 'The import stopped after 1 tries: flaky network',
    });
  });
});
