import type { NestExpressApplication } from '@nestjs/platform-express';
import type { PrismaClient } from '@tam/database';
import type { ForumTopicListDto, MessageDto, MessagePageDto, MessageSummaryDto } from '@tam/shared';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { archiveRows, postedAt } from './support/archive-rows.js';
import { createTestPrisma, insertUser } from './support/database.js';
import { FakeWorker } from './support/fake-worker.js';
import { expectApiError, nextClientIp, sessionCookie } from './support/http.js';
import { createTestApp } from './support/test-app.js';

const EMAIL = 'messages-reader@example.test';
const PASSWORD = 'correct horse battery staple';

describe('messages and topics (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let cookie: string;
  const worker = new FakeWorker();

  const http = () => request(app.getHttpServer());
  const get = (path: string) => http().get(path).set('Cookie', cookie);
  const post = (path: string) =>
    http().post(path).set('Cookie', cookie).set('X-Forwarded-For', nextClientIp()).send({});
  const list = async (query: string) =>
    (await get(`/api/messages?${query}`).expect(200)).body as MessagePageDto;
  const ids = (page: MessagePageDto) => page.items.map((item) => item.telegramMessageId);

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
    await worker.connect();
  });

  beforeEach(async () => {
    await prisma.$executeRaw`TRUNCATE TABLE channels, messages, media, download_jobs CASCADE`;
  });

  afterEach(async () => {
    await worker.reset();
  });

  afterAll(async () => {
    await worker.close();
    await app.close();
    await prisma.$disconnect();
  });

  const { addChannel, addMessage } = archiveRows(() => prisma);

  it.each(['/api/messages', '/api/messages/0199a0b1-0000-7000-8000-000000000001'])(
    'GET %s requires a session',
    async (path) => {
      expectApiError(await http().get(path), 401, 'UNAUTHENTICATED');
    },
  );

  describe('GET /api/messages', () => {
    it('lists newest first without service messages, page by page', async () => {
      const channel = await addChannel();
      for (let id = 1; id <= 7; id += 1) {
        await addMessage(channel, id, id === 4 ? { type: 'SERVICE', text: null } : {});
      }

      const first = await list('limit=2');
      expect(ids(first)).toEqual([7, 6]);
      expect(first.total).toBe(6);
      expect(first.nextCursor).toEqual(expect.any(String));

      const seen = [...ids(first)];
      let cursor = first.nextCursor;
      while (cursor) {
        const page = await list(`limit=2&cursor=${encodeURIComponent(cursor)}`);
        expect(page.total).toBeNull();
        seen.push(...ids(page));
        cursor = page.nextCursor;
      }
      expect(seen).toEqual([7, 6, 5, 3, 2, 1]);

      const oldest = await list('sort=oldest&limit=4');
      expect(ids(oldest)).toEqual([1, 2, 3, 5]);
      // A cursor only continues the order it was made for.
      expectApiError(
        await get(
          `/api/messages?sort=newest&cursor=${encodeURIComponent(oldest.nextCursor ?? '')}`,
        ),
        400,
        'INVALID_CURSOR',
      );
      expectApiError(await get('/api/messages?cursor=not-a-cursor'), 400, 'INVALID_CURSOR');
    });

    it('breaks ties between channels posting at the same moment', async () => {
      const first = await addChannel();
      const second = await addChannel();
      await addMessage(first, 1);
      await addMessage(second, 1);
      await addMessage(first, 2);

      const one = await list('limit=1');
      const two = await list(`limit=1&cursor=${encodeURIComponent(one.nextCursor ?? '')}`);
      const three = await list(`limit=1&cursor=${encodeURIComponent(two.nextCursor ?? '')}`);
      const channels = [...one.items, ...two.items, ...three.items].map((item) => item.channel.id);
      expect(new Set(channels.slice(1)).size).toBe(2);
      expect(three.nextCursor).toBeNull();
    });

    it('filters by channel (with its old basic group), types, dates and downloaded files', async () => {
      const channel = await addChannel({ title: 'Physics' });
      const oldGroup = await addChannel({ type: 'GROUP', migratedToChannelId: channel.id });
      const other = await addChannel();
      await addMessage(oldGroup, 1);
      await addMessage(channel, 2, {}, { type: 'VIDEO', status: 'DOWNLOADED' });
      await addMessage(channel, 3, {}, { type: 'VIDEO' });
      await addMessage(channel, 5, {}, { type: 'DOCUMENT' });
      await addMessage(channel, 6);
      await addMessage(other, 7);

      expect(ids(await list(`channelId=${channel.id}`))).toEqual([6, 5, 3, 2, 1]);
      expect(ids(await list(`channelId=${channel.id}&types=VIDEO,DOCUMENT`))).toEqual([5, 3, 2]);
      expect(ids(await list('downloaded=true'))).toEqual([2]);
      expect(ids(await list('downloaded=false'))).toEqual([5, 3]);
      // Message 4 would be 2026-01-02 00:00 UTC; 5 and 6 fall on that day, 7 does too.
      expect(ids(await list('from=2026-01-02&to=2026-01-02'))).toEqual([7, 6, 5]);
      expect(ids(await list('to=2026-01-02T06:00:00%2B00:00'))).toEqual([5, 3, 2, 1]);

      const page = await list(`channelId=${channel.id}&types=VIDEO`);
      expect(page.total).toBe(2);
      expect(page.items[1]).toMatchObject({
        telegramMessageId: 2,
        channel: { id: channel.id, title: 'Physics' },
        topic: null,
        media: {
          type: 'VIDEO',
          fileName: 'lesson-2.mp4',
          size: 2_000,
          downloadStatus: 'DOWNLOADED',
          hasThumbnail: false,
        },
      });
      expect(JSON.stringify(page)).not.toContain('telegramFileId');

      expectApiError(
        await get('/api/messages?channelId=0199a0b1-0000-7000-8000-00000000ffff'),
        404,
        'NOT_FOUND',
      );
      expectApiError(await get('/api/messages?types=HOLOGRAM'), 400, 'VALIDATION_FAILED');
      expectApiError(
        await get('/api/messages?from=2026-02-01&to=2026-01-01'),
        400,
        'VALIDATION_FAILED',
      );
    });

    it('lists the messages of one forum topic, General included', async () => {
      const forum = await addChannel({ isForum: true });
      await addMessage(forum, 10, { type: 'SERVICE', text: null });
      await addMessage(forum, 11, { threadId: 10, replyToMessageId: 10 }, { type: 'VIDEO' });
      await addMessage(forum, 12, { threadId: 10, replyToMessageId: 10 });
      await addMessage(forum, 13);
      await prisma.forumTopic.create({
        data: { channelId: forum.id, topicId: 10, title: 'Lesson one' },
      });

      const topic = await list(`channelId=${forum.id}&topicId=10&sort=oldest`);
      expect(ids(topic)).toEqual([11, 12]);
      expect(topic.items[0]?.topic).toEqual({ id: 10, title: 'Lesson one' });
      const general = await list(`channelId=${forum.id}&topicId=1`);
      expect(ids(general)).toEqual([13]);
      expect(general.items[0]?.topic).toEqual({ id: 1, title: 'General' });

      await prisma.forumTopic.deleteMany();
      expect((await list(`channelId=${forum.id}&topicId=10`)).items[0]?.topic).toEqual({
        id: 10,
        title: 'Topic #10',
      });
      expectApiError(await get('/api/messages?topicId=10'), 400, 'VALIDATION_FAILED');
    });

    it('cuts long texts for lists', async () => {
      const channel = await addChannel();
      await addMessage(channel, 1, { text: 'a'.repeat(499) + '😀' + 'b'.repeat(20) });
      const [item] = (await list('')).items as [MessageSummaryDto];
      // 499 characters, and never half of the emoji.
      expect(item.excerpt).toBe('a'.repeat(499));
    });
  });

  describe('GET /api/messages/:id', () => {
    it('returns the message with its formatting, file, album and neighbours', async () => {
      const channel = await addChannel({ username: 'physics_course', isForum: true });
      await prisma.forumTopic.create({
        data: { channelId: channel.id, topicId: 10, title: 'Optics' },
      });
      const previous = await addMessage(
        channel,
        11,
        { threadId: 10, replyToMessageId: 10 },
        { type: 'VIDEO' },
      );
      await addMessage(channel, 12, { threadId: 10, replyToMessageId: 10 });
      const albumFirst = await addMessage(
        channel,
        13,
        {
          threadId: 10,
          replyToMessageId: 10,
          mediaGroupId: 777n,
          caption: 'Lesson 1 — lenses',
          entities: [
            { kind: 'bold', offset: 0, length: 8 },
            { kind: 'textUrl', offset: 11, length: 6, params: { url: 'javascript:alert(1)' } },
            {
              kind: 'textUrl',
              offset: 11,
              length: 6,
              params: { url: 'https://example.com/lenses' },
            },
            { kind: 'customEmoji', offset: 0, length: 1, params: { documentId: '5' } },
            { kind: 'bold', offset: 10, length: 99 },
          ],
          telegramMeta: { postAuthor: 'Teacher', forwards: 3, pinned: true },
          forwardInfo: {
            date: '2025-12-24T10:00:00.000Z',
            fromChatId: '-1009',
            fromMessageId: '42',
            senderName: null,
          },
          views: 1_234,
        },
        { type: 'VIDEO', status: 'DOWNLOADED', thumbnail: true },
      );
      const albumSecond = await addMessage(
        channel,
        14,
        { threadId: 10, replyToMessageId: 10, mediaGroupId: 777n },
        { type: 'VIDEO' },
      );
      const next = await addMessage(
        channel,
        15,
        { threadId: 10, replyToMessageId: 10 },
        { type: 'VIDEO' },
      );
      await addMessage(channel, 16, {}, { type: 'VIDEO' });

      const body = (await get(`/api/messages/${albumFirst.id}`).expect(200)).body as MessageDto;
      expect(body).toMatchObject({
        id: albumFirst.id,
        telegramMessageId: 13,
        type: 'VIDEO',
        text: null,
        caption: 'Lesson 1 — lenses',
        topic: { id: 10, title: 'Optics' },
        views: 1_234,
        forwards: 3,
        postAuthor: 'Teacher',
        pinned: true,
        serviceAction: null,
        forward: {
          date: '2025-12-24T10:00:00.000Z',
          fromChatId: '-1009',
          fromMessageId: 42,
          senderName: null,
        },
        // In a forum every message points at its topic: that is no reply.
        replyTo: null,
        mediaGroupId: '777',
        telegramUrl: 'https://t.me/physics_course/13',
        media: {
          type: 'VIDEO',
          downloadStatus: 'DOWNLOADED',
          hasThumbnail: true,
          telegramMessageId: 13,
        },
      });
      expect(body.entities).toEqual([
        { kind: 'bold', offset: 0, length: 8 },
        { kind: 'textLink', offset: 11, length: 6, url: 'https://example.com/lenses' },
      ]);
      expect(body.album.map((item) => item.id)).toEqual([albumFirst.id, albumSecond.id]);
      // Same topic and category (videos), skipping the text message in between.
      expect(body.previousId).toBe(previous.id);
      expect(body.nextId).toBe(albumSecond.id);
      const last = (await get(`/api/messages/${next.id}`).expect(200)).body as MessageDto;
      expect(last.nextId).toBeNull();
    });

    it('points real replies at the archived message and links private chats', async () => {
      const channel = await addChannel({ telegramChatId: -1_001_234_567_890n, type: 'CHANNEL' });
      const question = await addMessage(channel, 20, { text: 'Where is lesson 2?' });
      const answer = await addMessage(channel, 21, { replyToMessageId: 20 });
      const orphan = await addMessage(channel, 22, { replyToMessageId: 5 });

      const body = (await get(`/api/messages/${answer.id}`).expect(200)).body as MessageDto;
      expect(body.replyTo).toEqual({
        telegramMessageId: 20,
        messageId: question.id,
        excerpt: 'Where is lesson 2?',
      });
      expect(body.telegramUrl).toBe('https://t.me/c/1234567890/21');
      expect(body.album).toEqual([]);
      expect(body.previousId).toBe(question.id);
      const missing = (await get(`/api/messages/${orphan.id}`).expect(200)).body as MessageDto;
      expect(missing.replyTo).toEqual({ telegramMessageId: 5, messageId: null, excerpt: null });
    });

    it('answers 404 for unknown messages and 400 for malformed ids', async () => {
      expectApiError(
        await get('/api/messages/0199a0b1-0000-7000-8000-00000000ffff'),
        404,
        'NOT_FOUND',
      );
      expectApiError(await get('/api/messages/not-a-uuid'), 400, 'VALIDATION_FAILED');
    });
  });

  describe('forum topics', () => {
    it('lists topics with their counts, in creation order', async () => {
      const forum = await addChannel({
        isForum: true,
        topicsRefreshedAt: new Date('2026-09-01T00:00:00Z'),
      });
      await prisma.forumTopic.createMany({
        data: [
          { channelId: forum.id, topicId: 1, title: 'General', isHidden: true },
          {
            channelId: forum.id,
            topicId: 30,
            title: 'Module 2',
            iconColor: 0xff93b2,
            isClosed: true,
          },
          {
            channelId: forum.id,
            topicId: 20,
            title: 'Module 1',
            isPinned: true,
            telegramDate: postedAt(20),
          },
          { channelId: forum.id, topicId: 40, title: 'Empty module' },
        ],
      });
      await addMessage(forum, 20, { type: 'SERVICE', text: null });
      await addMessage(forum, 21, { threadId: 20 }, { type: 'VIDEO' });
      await addMessage(forum, 22, { threadId: 20 }, { type: 'DOCUMENT' });
      await addMessage(forum, 23, { threadId: 20 });
      await addMessage(forum, 31, { threadId: 30 }, { type: 'PHOTO' });
      await addMessage(forum, 50, { threadId: 50 }, { type: 'AUDIO' });

      const body = (await get(`/api/channels/${forum.id}/topics`).expect(200))
        .body as ForumTopicListDto;
      expect(body.forum).toBe(true);
      expect(body.refreshedAt).toBe('2026-09-01T00:00:00.000Z');
      // The hidden General topic has no messages, so it is left out.
      expect(body.topics.map((topic) => [topic.topicId, topic.title])).toEqual([
        [20, 'Module 1'],
        [30, 'Module 2'],
        [40, 'Empty module'],
        [50, 'Topic #50'],
      ]);
      expect(body.topics[0]).toEqual({
        topicId: 20,
        title: 'Module 1',
        iconColor: null,
        isClosed: false,
        isPinned: true,
        createdAt: postedAt(20).toISOString(),
        counts: { messages: 3, videos: 1, images: 0, documents: 1, audio: 0 },
        firstPostedAt: postedAt(21).toISOString(),
        lastPostedAt: postedAt(23).toISOString(),
      });
      expect(body.topics[1]).toMatchObject({
        iconColor: '#ff93b2',
        isClosed: true,
        counts: { images: 1 },
      });
      expect(body.topics[2]?.counts.messages).toBe(0);
      expect(body.topics[3]?.counts.audio).toBe(1);
    });

    it('has no topics outside forums, and 404 for unknown channels', async () => {
      const plain = await addChannel();
      const body = (await get(`/api/channels/${plain.id}/topics`).expect(200))
        .body as ForumTopicListDto;
      expect(body).toEqual({ forum: false, refreshedAt: null, topics: [] });
      expectApiError(
        await get('/api/channels/0199a0b1-0000-7000-8000-00000000ffff/topics'),
        404,
        'NOT_FOUND',
      );
    });

    it('asks the worker to read the topics again', async () => {
      const forum = await addChannel({ isForum: true });
      await worker.setHeartbeat({ state: 'CONNECTED', detail: null });
      await worker.listen();
      worker.handler = async (rpc) => {
        if (rpc.call.method === 'topics.refresh') {
          await prisma.forumTopic.create({
            data: { channelId: rpc.call.channelId, topicId: 7, title: 'Fresh' },
          });
        }
        return { ok: true };
      };

      const body = (await post(`/api/channels/${forum.id}/topics/refresh`).expect(200))
        .body as ForumTopicListDto;
      expect(worker.requests.map((item) => item.call)).toEqual([
        { method: 'topics.refresh', channelId: forum.id },
      ]);
      expect(body.topics.map((topic) => topic.title)).toEqual(['Fresh']);

      worker.handler = () => ({
        ok: false,
        error: { code: 'NOT_A_FORUM', message: 'Not a forum' },
      });
      expectApiError(await post(`/api/channels/${forum.id}/topics/refresh`), 422, 'NOT_A_FORUM');

      const plain = await addChannel();
      expectApiError(await post(`/api/channels/${plain.id}/topics/refresh`), 422, 'NOT_A_FORUM');
      expect(worker.requests).toHaveLength(2);

      await worker.reset();
      expectApiError(
        await post(`/api/channels/${forum.id}/topics/refresh`),
        503,
        'WORKER_UNAVAILABLE',
      );
    });
  });
});
