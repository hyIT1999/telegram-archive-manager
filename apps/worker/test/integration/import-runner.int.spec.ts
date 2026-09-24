import type { Channel, ImportJob } from '@tam/database';
import type { PrismaService } from '@tam/database/nest';
import { type ImportJobData, JobStatus } from '@tam/shared';
import { ChatProtectedError, type Message } from '@tam/telegram';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ArchiveWriter } from '../../src/imports/archive-writer.js';
import type { ImportSettings } from '../../src/imports/import-settings.js';
import { ImportRunner } from '../../src/imports/import-runner.js';
import { ACCOUNT_KEY, TelegramAuthService } from '../../src/telegram/telegram-auth.service.js';
import {
  FakeChats,
  chatInfo,
  dateOf,
  history,
  photoMessage,
  textMessage,
} from './support/fake-chats.js';
import {
  createFakeTelegramApi,
  randomSecretBox,
  resetTelegramTables,
  testPrisma,
} from './support/telegram-fixtures.js';

const CHAT_ID = '-1001000000001';
const SETTINGS: ImportSettings = {
  pageDelayMs: 0,
  unavailableRetryMs: 10,
  reconcileIntervalMs: 60_000,
};

describe('ImportRunner', () => {
  let prisma: PrismaService;

  beforeAll(() => {
    prisma = testPrisma();
  });
  afterAll(async () => {
    await resetTelegramTables(prisma);
    await prisma.$disconnect();
  });
  beforeEach(() => resetTelegramTables(prisma));

  async function setup({ ready = true } = {}) {
    const fake = createFakeTelegramApi();
    const chats = new FakeChats(fake.api);
    const auth = new TelegramAuthService(prisma, fake.provider, randomSecretBox());
    const runner = new ImportRunner(
      prisma,
      fake.provider,
      auth,
      new ArchiveWriter(prisma),
      SETTINGS,
    );
    await prisma.telegramAccount.create({
      data: { accountKey: ACCOUNT_KEY, authState: ready ? 'READY' : 'LOGGED_OUT' },
    });
    return { ...fake, chats, runner };
  }

  async function addChannel(chatId = CHAT_ID): Promise<Channel> {
    return prisma.channel.create({
      data: { telegramChatId: BigInt(chatId), title: 'Lessons', type: 'CHANNEL' },
    });
  }

  async function newJob(
    channel: Channel,
    request: { fromDate?: Date } = {},
  ): Promise<ImportJobData> {
    const job = await prisma.importJob.create({
      data: {
        channelId: channel.id,
        runSeq: 1,
        mode: request.fromDate ? 'FROM_DATE' : 'ALL',
        fromDate: request.fromDate ?? null,
      },
    });
    return { importJobId: job.id, runSeq: 1 };
  }

  const jobOf = (data: ImportJobData): Promise<ImportJob> =>
    prisma.importJob.findUniqueOrThrow({ where: { id: data.importJobId } });
  const channelOf = (channel: Channel): Promise<Channel> =>
    prisma.channel.findUniqueOrThrow({ where: { id: channel.id } });
  const storedIds = async (channel: Channel): Promise<number[]> =>
    (
      await prisma.message.findMany({
        where: { channelId: channel.id },
        select: { telegramMessageId: true },
        orderBy: { telegramMessageId: 'asc' },
      })
    ).map((row) => row.telegramMessageId);
  const range = (from: number, to: number): number[] =>
    Array.from({ length: to - from + 1 }, (_, index) => from + index);

  it('imports the whole history with its media and completes with exact counts', async () => {
    const { runner, chats, api } = await setup();
    const messages: Message[] = history(CHAT_ID, 250);
    // Never archived: content protection and an auto-delete timer; still counted as read.
    messages[4] = textMessage(CHAT_ID, 5, { isContentProtected: true });
    messages[5] = textMessage(CHAT_ID, 6, { ttlPeriod: 86_400 });
    messages[6] = textMessage(CHAT_ID, 7, {
      type: 'SERVICE',
      text: null,
      isService: true,
      meta: { action: 'messageActionPinMessage' },
    });
    chats.addChat(chatInfo(CHAT_ID, { title: 'Lessons (renamed)', memberCount: 42 }), messages);
    const channel = await addChannel();
    const data = await newJob(channel);

    await expect(runner.run(data)).resolves.toBe('completed');

    expect(await storedIds(channel)).toEqual(range(1, 250).filter((id) => id !== 5 && id !== 6));
    const job = await jobOf(data);
    expect(job).toMatchObject({
      status: 'COMPLETED',
      phase: 'DONE',
      processedMessages: 250,
      totalMessages: 250,
      totalMedia: 25,
      totalBytes: 25_000n,
      statusDetail: null,
      error: null,
    });
    expect(job.startedAt).not.toBeNull();
    expect(job.completedAt).not.toBeNull();
    expect(await channelOf(channel)).toMatchObject({
      title: 'Lessons (renamed)',
      memberCount: 42,
      headMessageId: 250,
      backfillCursorId: 1,
      backfillComplete: true,
    });
    expect((await channelOf(channel)).lastSyncedAt).not.toBeNull();

    // Media rows point at their message, with one pending download each.
    const media = await prisma.media.findMany({ include: { message: true, downloadJob: true } });
    expect(media).toHaveLength(25);
    for (const item of media) {
      expect(item.telegramFileId).toBe(
        `${CHAT_ID}:${item.message.telegramMessageId}:${item.telegramFileUniqueId}`,
      );
      expect(item).toMatchObject({ type: 'PHOTO', downloadStatus: 'PENDING', size: 1_000n });
      expect(item.downloadJob).toMatchObject({ status: 'PENDING', importJobId: data.importJobId });
    }
    const photo = await prisma.message.findFirstOrThrow({ where: { telegramMessageId: 10 } });
    expect(photo).toMatchObject({ type: 'PHOTO', text: null, caption: 'Photo 10' });
    expect(photo.telegramDate).toEqual(dateOf(10));
    const service = await prisma.message.findFirstOrThrow({ where: { telegramMessageId: 7 } });
    expect(service).toMatchObject({
      type: 'SERVICE',
      telegramMeta: { action: 'messageActionPinMessage' },
    });

    // One estimate call, three pages of at most 100 and the empty page ending the history.
    expect(api.getHistoryPage).toHaveBeenCalledTimes(5);
    expect(api.getNewerMessages).not.toHaveBeenCalled();
  });

  it('resumes after a crash exactly where the stored pages end, storing nothing twice', async () => {
    const { runner, chats, api } = await setup();
    chats.addChat(chatInfo(CHAT_ID), history(CHAT_ID, 250));
    const channel = await addChannel();
    const data = await newJob(channel);

    // The fourth history call (third page) never gets an answer: the worker "dies".
    const real = api.getHistoryPage.getMockImplementation();
    let calls = 0;
    api.getHistoryPage.mockImplementation(async (...args) => {
      calls += 1;
      if (calls === 4) {
        throw new Error('socket hang up');
      }
      return real!(...args);
    });
    await expect(runner.run(data)).rejects.toThrow('socket hang up');

    expect(await jobOf(data)).toMatchObject({
      status: 'RUNNING',
      processedMessages: 200,
      totalMessages: 250,
    });
    expect(await channelOf(channel)).toMatchObject({
      headMessageId: 250,
      backfillCursorId: 51,
      backfillComplete: false,
    });
    expect(await storedIds(channel)).toEqual(range(51, 250));

    // The same run starts again (BullMQ retry or stalled job): it continues below the cursor.
    await expect(runner.run(data)).resolves.toBe('completed');
    expect(await storedIds(channel)).toEqual(range(1, 250));
    expect(await jobOf(data)).toMatchObject({
      status: 'COMPLETED',
      processedMessages: 250,
      totalMessages: 250,
    });
    expect(await prisma.media.count()).toBe(25);
    expect(await prisma.downloadJob.count()).toBe(25);
  });

  it('keeps only messages since the date, and a later import goes further back', async () => {
    const { runner, chats } = await setup();
    chats.addChat(chatInfo(CHAT_ID), history(CHAT_ID, 300));
    const channel = await addChannel();
    const since = await newJob(channel, { fromDate: dateOf(201) });

    await expect(runner.run(since)).resolves.toBe('completed');
    expect(await storedIds(channel)).toEqual(range(201, 300));
    expect(await channelOf(channel)).toMatchObject({
      headMessageId: 300,
      backfillCursorId: 201,
      backfillComplete: false,
    });
    expect(await jobOf(since)).toMatchObject({
      status: 'COMPLETED',
      processedMessages: 100,
      totalMessages: 100,
    });

    await prisma.importJob.update({
      where: { id: since.importJobId },
      data: { status: 'COMPLETED' },
    });
    const everything = await newJob(channel);
    await expect(runner.run(everything)).resolves.toBe('completed');
    expect(await storedIds(channel)).toEqual(range(1, 300));
    expect(await channelOf(channel)).toMatchObject({ backfillCursorId: 1, backfillComplete: true });
    expect(await jobOf(everything)).toMatchObject({ processedMessages: 200, totalMessages: 200 });
  });

  it('estimates the messages since the date from message ids while the job runs', async () => {
    const { runner, chats, api } = await setup();
    chats.addChat(chatInfo(CHAT_ID), history(CHAT_ID, 300));
    const channel = await addChannel();
    const data = await newJob(channel, { fromDate: dateOf(151) });
    const real = api.getHistoryPage.getMockImplementation();
    let estimate: number | null | undefined;
    api.getHistoryPage.mockImplementation(async (...args) => {
      if (args[1]?.beforeMessageId !== undefined) {
        estimate ??= (await jobOf(data)).totalMessages;
      }
      return real!(...args);
    });

    await runner.run(data);
    expect(estimate).toBe(150);
    expect(await jobOf(data)).toMatchObject({ processedMessages: 150, totalMessages: 150 });
  });

  it('reads messages posted since the last import, oldest first', async () => {
    const { runner, chats, api } = await setup();
    chats.addChat(chatInfo(CHAT_ID), history(CHAT_ID, 120));
    const channel = await addChannel();
    const first = await newJob(channel);
    await runner.run(first);

    chats.post(CHAT_ID, ...history(CHAT_ID, 130, 121));
    const next = await newJob(channel);
    api.getHistoryPage.mockClear();
    await expect(runner.run(next)).resolves.toBe('completed');

    expect(await storedIds(channel)).toEqual(range(1, 250));
    expect(await channelOf(channel)).toMatchObject({ headMessageId: 250, backfillCursorId: 1 });
    expect(await jobOf(next)).toMatchObject({ processedMessages: 130, totalMessages: 130 });
    expect(api.getNewerMessages.mock.calls.map(([, after]) => after)).toEqual([
      '120',
      '220',
      '250',
    ]);
    // The history below the range is complete: only the estimate reads a page.
    expect(api.getHistoryPage).toHaveBeenCalledTimes(1);
  });

  it('applies edits made since a page was stored', async () => {
    const writer = new ArchiveWriter(prisma);
    const channel = await addChannel();
    const job = await prisma.importJob.create({
      data: { channelId: channel.id, runSeq: 1, status: 'RUNNING' },
    });
    const page = { job: { id: job.id, runSeq: 1 }, channelId: channel.id };
    const original = photoMessage(CHAT_ID, 7);
    await writer.writePage({
      ...page,
      messages: [original],
      expected: { headMessageId: null, backfillCursorId: null },
      next: { headMessageId: 7, backfillCursorId: 7 },
    });

    const edited = { ...original, caption: 'Photo 7 (fixed)', editDate: dateOf(500), views: 99 };
    await expect(
      writer.writePage({
        ...page,
        messages: [edited],
        expected: { headMessageId: 7, backfillCursorId: 7 },
        next: {},
      }),
    ).resolves.toEqual({ added: 0, skipped: 0 });

    const stored = await prisma.message.findFirstOrThrow({ where: { telegramMessageId: 7 } });
    expect(stored).toMatchObject({ caption: 'Photo 7 (fixed)', views: 99 });
    expect(stored.editDate).toEqual(dateOf(500));
    expect(await prisma.media.count()).toBe(1);
    expect(
      (await prisma.importJob.findUniqueOrThrow({ where: { id: job.id } })).processedMessages,
    ).toBe(2);
  });

  it('refuses a page written against a range that moved meanwhile', async () => {
    const writer = new ArchiveWriter(prisma);
    const channel = await addChannel();
    const job = await prisma.importJob.create({
      data: { channelId: channel.id, runSeq: 1, status: 'RUNNING' },
    });
    await expect(
      writer.writePage({
        job: { id: job.id, runSeq: 1 },
        channelId: channel.id,
        messages: [textMessage(CHAT_ID, 3)],
        expected: { headMessageId: 99, backfillCursorId: 1 },
        next: { headMessageId: 100 },
      }),
    ).rejects.toThrow(/range changed/);
    expect(await prisma.message.count()).toBe(0);
    expect(
      (await prisma.importJob.findUniqueOrThrow({ where: { id: job.id } })).processedMessages,
    ).toBe(0);
  });

  it.each([
    ['PAUSED', JobStatus.PAUSED],
    ['CANCELLED', JobStatus.CANCELLED],
  ])(
    'stops at the page being stored when the job is %s, keeping the pages before',
    async (_, status) => {
      const { runner, chats, api } = await setup();
      chats.addChat(chatInfo(CHAT_ID), history(CHAT_ID, 250));
      const channel = await addChannel();
      const data = await newJob(channel);
      const real = api.getHistoryPage.getMockImplementation();
      api.getHistoryPage.mockImplementation(async (...args) => {
        if (args[1]?.beforeMessageId === '151') {
          // The user acts while the second page is being read from Telegram.
          await prisma.importJob.update({ where: { id: data.importJobId }, data: { status } });
        }
        return real!(...args);
      });

      await expect(runner.run(data)).resolves.toBe('interrupted');
      expect(await storedIds(channel)).toEqual(range(151, 250));
      expect(await jobOf(data)).toMatchObject({ status, processedMessages: 100 });
      expect(await channelOf(channel)).toMatchObject({ backfillCursorId: 151 });
    },
  );

  it('resumes a paused job with its next run and ignores runs it replaced', async () => {
    const { runner, chats, api } = await setup();
    chats.addChat(chatInfo(CHAT_ID), history(CHAT_ID, 150));
    const channel = await addChannel();
    const data = await newJob(channel);
    await prisma.importJob.update({ where: { id: data.importJobId }, data: { status: 'PAUSED' } });

    // Paused before it started: the queued run finds nothing to do.
    await expect(runner.run(data)).resolves.toBe('stale');
    expect(api.getHistoryPage).not.toHaveBeenCalled();

    await prisma.importJob.update({
      where: { id: data.importJobId },
      data: { status: 'PENDING', runSeq: 2 },
    });
    await expect(runner.run(data)).resolves.toBe('stale');
    await expect(runner.run({ ...data, runSeq: 2 })).resolves.toBe('completed');
    expect(await storedIds(channel)).toEqual(range(1, 150));
  });

  it('stops before reading when the chat turned protected, and stops syncing it', async () => {
    const { runner, chats, api } = await setup();
    chats.addChat(chatInfo(CHAT_ID, { isProtected: true }), history(CHAT_ID, 20));
    await prisma.telegramDialog.create({
      data: { telegramChatId: BigInt(CHAT_ID), title: 'Lessons', type: 'CHANNEL' },
    });
    const channel = await addChannel();
    await prisma.channel.update({ where: { id: channel.id }, data: { syncEnabled: true } });
    const data = await newJob(channel);

    await expect(runner.run(data)).rejects.toBeInstanceOf(ChatProtectedError);
    expect(await channelOf(channel)).toMatchObject({ isProtected: true, syncEnabled: false });
    expect(await prisma.telegramDialog.findFirstOrThrow()).toMatchObject({ isProtected: true });
    expect(api.getHistoryPage).not.toHaveBeenCalled();
    expect(await prisma.message.count()).toBe(0);

    await expect(runner.fail(data, 'Content protection was turned on')).resolves.toBe(true);
    expect(await jobOf(data)).toMatchObject({
      status: 'FAILED',
      error: 'Content protection was turned on',
    });
    // A finished job is never failed again.
    await expect(runner.fail(data, 'again')).resolves.toBe(false);
  });

  it('imports the old group of an upgraded supergroup into its own channel row', async () => {
    const { runner, chats } = await setup();
    const oldGroupId = '-777';
    chats.addChat(
      chatInfo(CHAT_ID, { type: 'SUPERGROUP', migratedFromChatId: oldGroupId }),
      history(CHAT_ID, 60),
    );
    chats.addOldGroup(
      { id: oldGroupId, title: 'Study group (before upgrade)', isProtected: false },
      history(oldGroupId, 130),
    );
    const channel = await addChannel();
    await prisma.channel.update({ where: { id: channel.id }, data: { type: 'SUPERGROUP' } });
    const data = await newJob(channel);

    await expect(runner.run(data)).resolves.toBe('completed');

    const oldGroup = await prisma.channel.findUniqueOrThrow({ where: { telegramChatId: -777n } });
    expect(oldGroup).toMatchObject({
      title: 'Study group (before upgrade)',
      type: 'GROUP',
      migratedToChannelId: channel.id,
      headMessageId: 130,
      backfillCursorId: 1,
      backfillComplete: true,
      storageFolder: 'Study group (before upgrade) (-777)',
    });
    expect(await storedIds(oldGroup)).toEqual(range(1, 130));
    expect(await storedIds(channel)).toEqual(range(1, 60));
    expect(await channelOf(channel)).toMatchObject({ migratedFromChatId: -777n });
    expect(await jobOf(data)).toMatchObject({
      processedMessages: 190,
      totalMessages: 190,
      totalMedia: 19,
    });
  });

  it('skips an old group this account cannot read', async () => {
    const { runner, chats } = await setup();
    chats.addChat(
      chatInfo(CHAT_ID, { type: 'SUPERGROUP', migratedFromChatId: '-778' }),
      history(CHAT_ID, 5),
    );
    const channel = await addChannel();
    const data = await newJob(channel);

    await expect(runner.run(data)).resolves.toBe('completed');
    expect(await prisma.channel.count()).toBe(1);
    expect(await jobOf(data)).toMatchObject({ processedMessages: 5 });
  });

  it('leaves the job PENDING while Telegram is logged out', async () => {
    const { runner, chats, api } = await setup({ ready: false });
    chats.addChat(chatInfo(CHAT_ID), history(CHAT_ID, 5));
    const channel = await addChannel();
    const data = await newJob(channel);

    await expect(runner.run(data)).rejects.toMatchObject({ code: 'TELEGRAM_NOT_READY' });
    expect(await jobOf(data)).toMatchObject({ status: 'PENDING', startedAt: null });
    expect(api.refreshChat).not.toHaveBeenCalled();

    await runner.noteWaiting(data, 'Waiting for Telegram');
    expect(await jobOf(data)).toMatchObject({ statusDetail: 'Waiting for Telegram' });
  });

  it('completes an empty chat, and a later import picks up its first messages', async () => {
    const { runner, chats } = await setup();
    chats.addChat(chatInfo(CHAT_ID), []);
    const channel = await addChannel();
    await expect(runner.run(await newJob(channel))).resolves.toBe('completed');
    expect(await channelOf(channel)).toMatchObject({ headMessageId: null, backfillComplete: true });
    await prisma.importJob.updateMany({ data: { status: 'COMPLETED' } });

    chats.post(CHAT_ID, ...history(CHAT_ID, 5));
    const next = await newJob(channel);
    await expect(runner.run(next)).resolves.toBe('completed');
    expect(await storedIds(channel)).toEqual(range(1, 5));
    expect(await channelOf(channel)).toMatchObject({
      headMessageId: 5,
      backfillCursorId: 1,
      backfillComplete: true,
    });
  });
});
