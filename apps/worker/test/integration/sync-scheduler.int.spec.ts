import type { Channel } from '@tam/database';
import type { PrismaService } from '@tam/database/nest';
import { IMPORT_RUN_JOB_NAME, type ImportJobData, QUEUES, jobIds } from '@tam/shared';
import { ChatUnavailableError, FloodWaitError } from '@tam/telegram';
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
import { SYNC_NOTES } from '../../src/common/sync-notes.js';
import { NewMessagesListener } from '../../src/sync/new-messages.listener.js';
import { SyncScheduler } from '../../src/sync/sync-scheduler.js';
import {
  DEFAULT_SYNC_SCHEDULER_SETTINGS,
  type SyncSchedulerSettings,
} from '../../src/sync/sync-settings.js';
import { ACCOUNT_KEY, TelegramAuthService } from '../../src/telegram/telegram-auth.service.js';
import { TelegramCooldown } from '../../src/telegram/telegram-cooldown.js';
import { TelegramUpdates } from '../../src/telegram/telegram-updates.js';
import { FakeChats, chatInfo, history } from './support/fake-chats.js';
import {
  createFakeTelegramApi,
  randomSecretBox,
  resetTelegramTables,
  testPrisma,
} from './support/telegram-fixtures.js';
import { TEST_BULLMQ_PREFIX } from './test-env.js';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe('sync scheduler', () => {
  let prisma: PrismaService;
  let chatSequence = 0;
  const queue = new Queue<ImportJobData>(QUEUES.telegramSync, {
    connection: { url: inject('redisUrl') },
    prefix: TEST_BULLMQ_PREFIX,
  });

  beforeAll(() => {
    prisma = testPrisma();
  });
  beforeEach(async () => {
    await resetTelegramTables(prisma);
  });
  afterEach(async () => {
    await queue.obliterate({ force: true });
  });
  afterAll(async () => {
    await queue.close();
    await resetTelegramTables(prisma);
    await prisma.$disconnect();
  });

  async function setup(settings: Partial<SyncSchedulerSettings> = {}) {
    const fake = createFakeTelegramApi();
    const chats = new FakeChats(fake.api);
    const auth = new TelegramAuthService(prisma, fake.provider, randomSecretBox());
    const cooldown = new TelegramCooldown();
    const updates = new TelegramUpdates();
    const all: SyncSchedulerSettings = {
      ...DEFAULT_SYNC_SCHEDULER_SETTINGS,
      tickMs: null,
      syncedChatsMaxAgeMs: 0,
      ...settings,
    };
    const listener = new NewMessagesListener(prisma, updates, all);
    listener.onApplicationBootstrap();
    const scheduler = new SyncScheduler(
      prisma,
      listener,
      updates,
      auth,
      cooldown,
      fake.provider,
      queue,
      all,
    );
    await prisma.telegramAccount.create({ data: { accountKey: ACCOUNT_KEY, authState: 'READY' } });
    return { ...fake, chats, cooldown, updates, listener, scheduler };
  }

  /** An archived channel (messages up to `head`), and its chat on Telegram (up to `newest`). */
  async function addChannel(
    chats: FakeChats,
    {
      head,
      newest = head,
      ...data
    }: { head: number | null; newest?: number | null } & Partial<Channel>,
  ): Promise<Channel & { chatId: string }> {
    chatSequence += 1;
    const chatId = String(-1_004_000_000_000 - chatSequence);
    chats.addChat(chatInfo(chatId), newest === null ? [] : history(chatId, newest));
    const channel = await prisma.channel.create({
      data: {
        telegramChatId: BigInt(chatId),
        title: `Course ${chatSequence}`,
        type: 'CHANNEL',
        headMessageId: head,
        backfillCursorId: head === null ? null : 1,
        ...data,
      },
    });
    return { ...channel, chatId };
  }

  const syncsOf = (channel: Channel) =>
    prisma.importJob.findMany({ where: { channelId: channel.id, type: 'SYNC' } });
  const channelOf = (channel: Channel) =>
    prisma.channel.findUniqueOrThrow({ where: { id: channel.id } });
  const ago = (ms: number) => new Date(Date.now() - ms);

  describe('scheduled checks', () => {
    it('checks the channels due: nothing new records the time, new messages get a sync', async () => {
      const { scheduler, chats, api } = await setup();
      const upToDate = await addChannel(chats, { head: 100 });
      const behind = await addChannel(chats, { head: 50, newest: 60, lastSyncedAt: ago(HOUR) });
      const recent = await addChannel(chats, { head: 20, newest: 30, lastSyncedAt: ago(MINUTE) });
      const switchedOff = await addChannel(chats, { head: 5, newest: 9, syncEnabled: false });
      const neverImported = await addChannel(chats, { head: null, newest: 9 });
      const protectedChat = await addChannel(chats, { head: 5, newest: 9, isProtected: true });
      const oldGroup = await addChannel(chats, {
        head: 5,
        newest: 9,
        migratedToChannelId: upToDate.id,
      });

      await expect(scheduler.syncDue()).resolves.toEqual({ announced: 0, checked: 2, queued: 1 });

      const checked = api.getHistoryPage.mock.calls.map(([chatId]) => chatId);
      expect(checked.sort()).toEqual([upToDate.chatId, behind.chatId].sort());
      expect((await channelOf(upToDate)).lastSyncedAt?.getTime()).toBeGreaterThan(
        Date.now() - MINUTE,
      );
      const [sync] = await syncsOf(behind);
      expect(sync).toMatchObject({
        type: 'SYNC',
        origin: 'SCHEDULE',
        status: 'PENDING',
        runSeq: 1,
        totalMessages: 10,
      });
      const run = await queue.getJob(jobIds.importRun(sync!.id, 1));
      expect(run).toMatchObject({
        name: IMPORT_RUN_JOB_NAME,
        data: { importJobId: sync!.id, runSeq: 1 },
      });
      for (const channel of [recent, switchedOff, neverImported, protectedChat, oldGroup]) {
        expect(await syncsOf(channel)).toEqual([]);
      }

      // Nothing is due any more: one checked, the other has its sync waiting.
      api.getHistoryPage.mockClear();
      await expect(scheduler.syncDue()).resolves.toEqual({ announced: 0, checked: 0, queued: 0 });
      expect(api.getHistoryPage).not.toHaveBeenCalled();
    });

    it('follows the interval of the settings', async () => {
      const { scheduler, chats } = await setup();
      const channel = await addChannel(chats, { head: 10, lastSyncedAt: ago(2 * HOUR) });
      await prisma.appSetting.create({ data: { key: 'sync', value: { intervalMinutes: 180 } } });
      await expect(scheduler.syncDue()).resolves.toMatchObject({ checked: 0 });

      await prisma.appSetting.update({
        where: { key: 'sync' },
        data: { value: { intervalMinutes: 60 } },
      });
      await expect(scheduler.syncDue()).resolves.toMatchObject({ checked: 1 });
      expect((await channelOf(channel)).lastSyncedAt?.getTime()).toBeGreaterThan(
        Date.now() - MINUTE,
      );
    });

    it('leaves channels a job holds, and waits after a failed sync', async () => {
      const { scheduler, chats, api } = await setup();
      const importing = await addChannel(chats, { head: 10, newest: 20 });
      await prisma.importJob.create({ data: { channelId: importing.id, status: 'RUNNING' } });
      const failedLately = await addChannel(chats, {
        head: 10,
        newest: 20,
        lastSyncedAt: ago(DAY),
      });
      await prisma.importJob.create({
        data: {
          channelId: failedLately.id,
          type: 'SYNC',
          status: 'FAILED',
          createdAt: ago(HOUR),
          completedAt: ago(HOUR),
        },
      });
      const failedLongAgo = await addChannel(chats, {
        head: 10,
        newest: 10,
        lastSyncedAt: ago(DAY),
      });
      await prisma.importJob.create({
        data: {
          channelId: failedLongAgo.id,
          type: 'SYNC',
          status: 'FAILED',
          createdAt: ago(7 * HOUR),
          completedAt: ago(7 * HOUR),
        },
      });

      await expect(scheduler.syncDue()).resolves.toEqual({ announced: 0, checked: 1, queued: 0 });
      expect(api.getHistoryPage.mock.calls.map(([chatId]) => chatId)).toEqual([
        failedLongAgo.chatId,
      ]);
    });

    it('checks a few channels per round and stops when Telegram asks to wait', async () => {
      const { scheduler, chats, api, cooldown } = await setup({ checkBatch: 2 });
      for (let index = 0; index < 3; index += 1) {
        await addChannel(chats, { head: 10 });
      }
      await expect(scheduler.syncDue()).resolves.toMatchObject({ checked: 2 });

      api.getHistoryPage.mockRejectedValueOnce(new FloodWaitError(30));
      await expect(scheduler.syncDue()).resolves.toMatchObject({ checked: 0 });
      expect(cooldown.remainingMs()).toBeGreaterThan(0);
      // Waiting: the next round asks nothing.
      api.getHistoryPage.mockClear();
      await expect(scheduler.syncDue()).resolves.toMatchObject({ checked: 0 });
      expect(api.getHistoryPage).not.toHaveBeenCalled();
    });

    it('switches sync off for a chat this account can no longer read', async () => {
      const { scheduler, chats, api } = await setup();
      const channel = await addChannel(chats, { head: 10 });
      api.getHistoryPage.mockRejectedValueOnce(new ChatUnavailableError('The chat is gone'));

      await scheduler.syncDue();
      expect(await channelOf(channel)).toMatchObject({
        syncEnabled: false,
        syncNote: SYNC_NOTES.unreadable,
      });
    });

    it('waits before checking again a channel whose check failed unexpectedly', async () => {
      const { scheduler, chats, api } = await setup();
      await addChannel(chats, { head: 10 });
      api.getHistoryPage.mockRejectedValueOnce(new Error('Telegram is having a bad day'));

      await expect(scheduler.syncDue()).resolves.toMatchObject({ checked: 0 });
      await expect(scheduler.syncDue()).resolves.toMatchObject({ checked: 0 });
      expect(api.getHistoryPage).toHaveBeenCalledTimes(1);
      await expect(scheduler.syncDue(new Date(Date.now() + 31 * MINUTE))).resolves.toMatchObject({
        checked: 1,
      });
    });

    it('does nothing while Telegram is not ready, and starts receiving updates when it is', async () => {
      const { scheduler, chats, api, updates } = await setup();
      await addChannel(chats, { head: 10 });
      const start = vi.fn(async () => undefined);
      updates.attach(start);
      await prisma.telegramAccount.update({
        where: { accountKey: ACCOUNT_KEY },
        data: { authState: 'LOGGED_OUT' },
      });
      await expect(scheduler.syncDue()).resolves.toEqual({ announced: 0, checked: 0, queued: 0 });
      expect(start).not.toHaveBeenCalled();
      expect(api.getHistoryPage).not.toHaveBeenCalled();

      await prisma.telegramAccount.update({
        where: { accountKey: ACCOUNT_KEY },
        data: { authState: 'READY' },
      });
      await scheduler.syncDue();
      expect(start).toHaveBeenCalledTimes(1);
    });
  });

  describe('messages Telegram announces', () => {
    it('syncs a channel Telegram announced new messages for, once a minute at most', async () => {
      const { scheduler, chats, listener, updates } = await setup();
      const channel = await addChannel(chats, { head: 60, lastSyncedAt: new Date() });
      updates.emit({ kind: 'new_message', chatId: channel.chatId, messageId: '61' });
      await vi.waitFor(() => expect(listener.pending().get(channel.id)).toBe(61));

      await expect(scheduler.syncDue()).resolves.toMatchObject({ announced: 1 });
      const [sync] = await syncsOf(channel);
      expect(sync).toMatchObject({ origin: 'TELEGRAM_UPDATE', totalMessages: 1 });
      expect(await queue.getJob(jobIds.importRun(sync!.id, 1))).toBeDefined();
      expect(listener.pending().size).toBe(0);

      // Done, and another message soon after: it waits for the minute to pass.
      await prisma.importJob.update({ where: { id: sync!.id }, data: { status: 'COMPLETED' } });
      await prisma.channel.update({ where: { id: channel.id }, data: { headMessageId: 61 } });
      await listener.handle({ kind: 'new_message', chatId: channel.chatId, messageId: '62' });
      await expect(scheduler.syncDue()).resolves.toMatchObject({ announced: 0 });
      expect(listener.pending().get(channel.id)).toBe(62);
      await expect(scheduler.syncDue(new Date(Date.now() + 61_000))).resolves.toMatchObject({
        announced: 1,
      });
      expect(await syncsOf(channel)).toHaveLength(2);
    });

    it('waits while a job holds the channel, and forgets what the archive already has', async () => {
      const { scheduler, chats, listener } = await setup();
      const busy = await addChannel(chats, { head: 60, lastSyncedAt: new Date() });
      const job = await prisma.importJob.create({
        data: { channelId: busy.id, status: 'RUNNING' },
      });
      const current = await addChannel(chats, { head: 100, lastSyncedAt: new Date() });
      await listener.handle({ kind: 'new_message', chatId: busy.chatId, messageId: '70' });
      await listener.handle({ kind: 'new_message', chatId: current.chatId, messageId: '99' });

      await expect(scheduler.syncDue()).resolves.toMatchObject({ announced: 0 });
      expect([...listener.pending()]).toEqual([[busy.id, 70]]);

      // The import read message 70 on its way: nothing left to sync.
      await prisma.importJob.update({ where: { id: job.id }, data: { status: 'COMPLETED' } });
      await prisma.channel.update({ where: { id: busy.id }, data: { headMessageId: 75 } });
      await expect(scheduler.syncDue()).resolves.toMatchObject({ announced: 0 });
      expect(listener.pending().size).toBe(0);
      expect(await syncsOf(busy)).toEqual([]);
    });

    it('ignores other chats, channels that do not sync, edits and deletions', async () => {
      const { scheduler, chats, listener } = await setup();
      const synced = await addChannel(chats, { head: 10, lastSyncedAt: new Date() });
      const off = await addChannel(chats, { head: 10, syncEnabled: false });
      await listener.handle({ kind: 'new_message', chatId: '-1009999', messageId: '11' });
      await listener.handle({ kind: 'new_message', chatId: off.chatId, messageId: '11' });
      await listener.handle({ kind: 'edit_message', chatId: synced.chatId, messageId: '5' });
      await listener.handle({ kind: 'delete_messages', chatId: synced.chatId, messageIds: ['5'] });

      expect(listener.pending().size).toBe(0);
      await expect(scheduler.syncDue()).resolves.toEqual({ announced: 0, checked: 0, queued: 0 });
    });
  });

  it('forgets automatic syncs a month after they ended, not the ones people asked for', async () => {
    const { scheduler, chats } = await setup();
    const channel = await addChannel(chats, { head: 10, lastSyncedAt: new Date() });
    const sync = (data: {
      origin?: 'MANUAL' | 'SCHEDULE';
      status?: 'COMPLETED' | 'FAILED';
      endedDaysAgo: number;
    }) =>
      prisma.importJob.create({
        data: {
          channelId: channel.id,
          type: 'SYNC',
          origin: data.origin ?? 'SCHEDULE',
          status: data.status ?? 'COMPLETED',
          completedAt: ago(data.endedDaysAgo * DAY),
        },
      });
    const old = await sync({ endedDaysAgo: 31 });
    const oldFailed = await sync({ status: 'FAILED', endedDaysAgo: 40 });
    const asked = await sync({ origin: 'MANUAL', endedDaysAgo: 31 });
    const recent = await sync({ endedDaysAgo: 10 });

    await scheduler.syncDue();
    const left = (await syncsOf(channel)).map((job) => job.id).sort();
    expect(left).toEqual([asked.id, recent.id].sort());
    expect(left).not.toContain(old.id);
    expect(left).not.toContain(oldFailed.id);
  });
});
