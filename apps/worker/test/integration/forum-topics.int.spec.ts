import type { PrismaService } from '@tam/database/nest';
import {
  ChatUnavailableError,
  FloodWaitError,
  type ForumTopic,
  NotAForumError,
} from '@tam/telegram';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ForumTopicsService } from '../../src/telegram/forum-topics.service.js';
import { ACCOUNT_KEY, TelegramAuthService } from '../../src/telegram/telegram-auth.service.js';
import { TelegramCooldown } from '../../src/telegram/telegram-cooldown.js';
import { ForumTopicsRefresher } from '../../src/topics/forum-topics-refresher.js';
import { DEFAULT_TOPICS_SETTINGS, type TopicsSettings } from '../../src/topics/topics-settings.js';
import {
  createFakeTelegramApi,
  forumTopic,
  randomSecretBox,
  resetTelegramTables,
  testPrisma,
} from './support/telegram-fixtures.js';

describe('forum topics', () => {
  let prisma: PrismaService;
  let chatSequence = 0;

  beforeAll(() => {
    prisma = testPrisma();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });
  beforeEach(async () => {
    await resetTelegramTables(prisma);
  });

  async function setup({ ready = true, settings = {} as Partial<TopicsSettings> } = {}) {
    const fake = createFakeTelegramApi();
    const auth = new TelegramAuthService(prisma, fake.provider, randomSecretBox());
    const topics = new ForumTopicsService(prisma, fake.provider, auth);
    const cooldown = new TelegramCooldown();
    const refresher = new ForumTopicsRefresher(prisma, topics, auth, cooldown, fake.provider, {
      ...DEFAULT_TOPICS_SETTINGS,
      checkIntervalMs: null,
      ...settings,
    });
    await prisma.telegramAccount.create({
      data: { accountKey: ACCOUNT_KEY, authState: ready ? 'READY' : 'LOGGED_OUT' },
    });
    return { ...fake, topics, refresher, cooldown };
  }

  async function addChannel(
    data: { isForum?: boolean; isProtected?: boolean; topicsRefreshedAt?: Date } = {},
  ) {
    chatSequence += 1;
    return prisma.channel.create({
      data: {
        telegramChatId: BigInt(-1_003_000_000_000 - chatSequence),
        title: `Course ${chatSequence}`,
        type: 'SUPERGROUP',
        isForum: data.isForum ?? true,
        isProtected: data.isProtected ?? false,
        topicsRefreshedAt: data.topicsRefreshedAt ?? null,
      },
    });
  }

  const stored = (channelId: string) =>
    prisma.forumTopic.findMany({ where: { channelId }, orderBy: { topicId: 'asc' } });

  describe('ForumTopicsService', () => {
    it('stores the topics of a forum and records when they were read', async () => {
      const { topics, api } = await setup();
      const channel = await addChannel();
      api.getForumTopics.mockResolvedValueOnce([
        forumTopic(1, { isHidden: true }),
        forumTopic(5, { isPinned: true, iconColor: 0xff93b2 }),
        forumTopic(9, { isClosed: true }),
      ]);

      await expect(topics.refresh(channel.id)).resolves.toBe(3);

      expect(api.getForumTopics).toHaveBeenCalledWith(channel.telegramChatId.toString());
      const rows = await stored(channel.id);
      expect(
        rows.map((row) => [row.topicId, row.title, row.isPinned, row.isClosed, row.isHidden]),
      ).toEqual([
        [1, 'General', false, false, true],
        [5, 'Lesson 5', true, false, false],
        [9, 'Lesson 9', false, true, false],
      ]);
      expect(rows[1]?.iconColor).toBe(0xff93b2);
      expect(rows[2]?.telegramDate).toEqual(forumTopic(9).date);
      const after = await prisma.channel.findUniqueOrThrow({ where: { id: channel.id } });
      expect(after.topicsRefreshedAt).not.toBeNull();
    });

    it('follows renames and keeps topics that left Telegram', async () => {
      const { topics, api } = await setup();
      const channel = await addChannel();
      api.getForumTopics.mockResolvedValueOnce([forumTopic(5), forumTopic(9)]);
      await topics.refresh(channel.id);

      api.getForumTopics.mockResolvedValueOnce([forumTopic(5, { title: 'Lesson 5 (updated)' })]);
      await topics.refresh(channel.id);

      const rows = await stored(channel.id);
      expect(rows.map((row) => [row.topicId, row.title])).toEqual([
        [5, 'Lesson 5 (updated)'],
        [9, 'Lesson 9'],
      ]);
    });

    it('asks Telegram once for concurrent refreshes of the same forum', async () => {
      const { topics, api } = await setup();
      const channel = await addChannel();
      let release!: (value: ForumTopic[]) => void;
      api.getForumTopics.mockImplementationOnce(
        () => new Promise((resolve) => (release = resolve)),
      );

      const first = topics.refresh(channel.id);
      const second = topics.refresh(channel.id);
      await expect.poll(() => api.getForumTopics.mock.calls.length).toBe(1);
      release([forumTopic(2)]);

      await expect(Promise.all([first, second])).resolves.toEqual([1, 1]);
      expect(api.getForumTopics).toHaveBeenCalledTimes(1);
    });

    it('refuses chats without topics, unknown channels and a logged-out account', async () => {
      const { topics, api } = await setup();
      const plain = await addChannel({ isForum: false });
      await expect(topics.refresh(plain.id)).rejects.toBeInstanceOf(NotAForumError);
      await expect(topics.refresh('0199a0b1-0000-7000-8000-00000000ffff')).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });

      await prisma.telegramAccount.update({
        where: { accountKey: ACCOUNT_KEY },
        data: { authState: 'LOGGED_OUT' },
      });
      const forum = await addChannel();
      await expect(topics.refresh(forum.id)).rejects.toMatchObject({ code: 'TELEGRAM_NOT_READY' });
      expect(api.getForumTopics).not.toHaveBeenCalled();
    });

    it('stops treating a chat as a forum when Telegram says it has no topics', async () => {
      const { topics, api } = await setup();
      const channel = await addChannel();
      api.getForumTopics.mockRejectedValueOnce(new NotAForumError());

      await expect(topics.refresh(channel.id)).rejects.toBeInstanceOf(NotAForumError);
      const after = await prisma.channel.findUniqueOrThrow({ where: { id: channel.id } });
      expect(after.isForum).toBe(false);
      expect(after.topicsRefreshedAt).not.toBeNull();
    });
  });

  describe('ForumTopicsRefresher', () => {
    it('reads forums that have no topics yet or old ones, and nothing else', async () => {
      const { refresher, api } = await setup();
      const fresh = await addChannel({ topicsRefreshedAt: new Date() });
      const never = await addChannel();
      const stale = await addChannel({ topicsRefreshedAt: new Date(Date.now() - 2 * 86_400_000) });
      await addChannel({ isForum: false });
      await addChannel({ isProtected: true });
      api.getForumTopics.mockResolvedValue([forumTopic(3)]);

      await expect(refresher.refreshDue()).resolves.toBe(2);

      const asked = api.getForumTopics.mock.calls.map(([chatId]) => chatId);
      expect(asked).toEqual([never.telegramChatId.toString(), stale.telegramChatId.toString()]);
      expect(await stored(never.id)).toHaveLength(1);
      expect(await stored(fresh.id)).toHaveLength(0);
      // Now up to date: the next round has nothing to do.
      await expect(refresher.refreshDue()).resolves.toBe(0);
    });

    it('waits while Telegram is not ready or asks to wait', async () => {
      const notReady = await setup({ ready: false });
      await addChannel();
      await expect(notReady.refresher.refreshDue()).resolves.toBe(0);
      expect(notReady.api.getForumTopics).not.toHaveBeenCalled();

      await prisma.telegramAccount.update({
        where: { accountKey: ACCOUNT_KEY },
        data: { authState: 'READY' },
      });
      notReady.api.getForumTopics.mockRejectedValueOnce(new FloodWaitError(90));
      await addChannel();
      await expect(notReady.refresher.refreshDue()).resolves.toBe(0);
      // One request, then the wait: the second forum was not asked for.
      expect(notReady.api.getForumTopics).toHaveBeenCalledTimes(1);
      expect(notReady.cooldown.remainingMs()).toBeGreaterThan(80_000);
      await expect(notReady.refresher.refreshDue()).resolves.toBe(0);
      expect(notReady.api.getForumTopics).toHaveBeenCalledTimes(1);
    });

    it('gives a forum that failed some time before trying it again', async () => {
      const { refresher, api } = await setup();
      const broken = await addChannel();
      const fine = await addChannel();
      api.getForumTopics.mockImplementation(async (chatId) => {
        if (chatId === broken.telegramChatId.toString()) {
          throw new ChatUnavailableError();
        }
        return [forumTopic(4)];
      });

      await expect(refresher.refreshDue()).resolves.toBe(1);
      expect(await stored(fine.id)).toHaveLength(1);
      api.getForumTopics.mockClear();
      await expect(refresher.refreshDue()).resolves.toBe(0);
      expect(api.getForumTopics).not.toHaveBeenCalled();
    });
  });
});
