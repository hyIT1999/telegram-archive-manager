import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Message, PrismaClient } from '@tam/database';
import type { MessagePageDto, MessageSummaryDto, TextRange } from '@tam/shared';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { archiveRows } from './support/archive-rows.js';
import { createTestPrisma, insertUser } from './support/database.js';
import { expectApiError, nextClientIp, sessionCookie } from './support/http.js';
import { createTestApp } from './support/test-app.js';

const EMAIL = 'searcher@example.test';
const PASSWORD = 'correct horse battery staple';

/** The parts of a string that ranges mark. */
function slices(value: string | null | undefined, ranges: readonly TextRange[] = []): string[] {
  return ranges.map(([at, length]) => (value ?? '').slice(at, at + length));
}

/** The words a result marks in its file name. */
function markedInName(item: MessageSummaryDto | undefined): string[] {
  return slices(item?.media?.fileName, item?.matches?.fileName);
}

describe('search (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let cookie: string;

  const http = () => request(app.getHttpServer());
  const get = (path: string) => http().get(path).set('Cookie', cookie);
  const search = async (query: string) =>
    (await get(`/api/search?${query}`).expect(200)).body as MessagePageDto;
  const list = async (query: string) =>
    (await get(`/api/messages?${query}`).expect(200)).body as MessagePageDto;
  const ids = (page: MessagePageDto) => page.items.map((item) => item.telegramMessageId);
  const { addChannel, addMessage } = archiveRows(() => prisma);

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
    await prisma.$executeRaw`TRUNCATE TABLE channels, messages, media, download_jobs, tags CASCADE`;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('requires a session', async () => {
    expectApiError(await http().get('/api/search?q=lesson'), 401, 'UNAUTHENTICATED');
  });

  it('finds file names, text and captions without accents, by the start of words', async () => {
    const channel = await addChannel();
    await addMessage(channel, 1, {}, { fileName: 'Bài 2 Ôn tập.mp4' });
    await addMessage(channel, 2, {}, { fileName: 'Bài 20 Wave_Zone.mp4' });
    await addMessage(channel, 3, { text: 'Học lập trình với Angular' });
    await addMessage(
      channel,
      4,
      { caption: 'Harbour at dawn' },
      { type: 'PHOTO', fileName: 'IMG_20240101.jpg' },
    );
    await addMessage(channel, 5, { text: 'Nothing to see' });

    const lessons = await search('q=bai%202');
    // The whole word "2" beats "20", which only starts with it.
    expect(ids(lessons)).toEqual([1, 2]);
    expect(lessons.total).toBe(2);
    expect(markedInName(lessons.items[0])).toEqual(['Bài', '2']);
    expect(markedInName(lessons.items[1])).toEqual(['Bài', '20']);

    expect(ids(await search('q=on%20tap'))).toEqual([1]);
    expect(ids(await search('q=zone'))).toEqual([2]);
    expect(ids(await search('q=H%E1%BB%8DC%20angular'))).toEqual([3]);
    expect(ids(await search('q=harb'))).toEqual([4]);
    expect(ids(await search('q=20240101'))).toEqual([4]);
    expect(ids(await search('q=python'))).toEqual([]);

    const [text] = (await search('q=lap%20trinh')).items;
    expect(slices(text?.excerpt, text?.matches?.excerpt)).toEqual(['lập', 'trình']);
  });

  it('ranks the words as typed first, then whole words, then word starts', async () => {
    const channel = await addChannel();
    await addMessage(channel, 1, {}, { fileName: 'Buổi 100.mp4' });
    await addMessage(channel, 2, {}, { fileName: 'Buổi 1 và 10 ghi chú.mp4' });
    await addMessage(channel, 3, {}, { fileName: 'Buổi 10.mp4' });

    expect(ids(await search('q=buoi%2010'))).toEqual([3, 2, 1]);
  });

  it('opens the excerpt at a match deep inside a long text', async () => {
    const channel = await addChannel();
    await addMessage(channel, 1, { text: `${'Background words. '.repeat(50)}The needle is here.` });

    const [item] = (await search('q=needle')).items;
    expect(item?.excerpt?.startsWith('…')).toBe(true);
    expect(slices(item?.excerpt, item?.matches?.excerpt)).toEqual(['needle']);
  });

  it('pages through the best matches, the newest or the oldest without repeats', async () => {
    const channel = await addChannel();
    for (let id = 1; id <= 7; id += 1) {
      // Equal ranks: the date decides.
      await addMessage(channel, id, {}, { fileName: `Lesson notes ${id}.pdf`, type: 'DOCUMENT' });
    }

    async function all(query: string): Promise<number[]> {
      const seen: number[] = [];
      let page = await search(`${query}&limit=3`);
      expect(page.total).toBe(7);
      seen.push(...ids(page));
      while (page.nextCursor) {
        page = await search(`${query}&limit=3&cursor=${encodeURIComponent(page.nextCursor)}`);
        expect(page.total).toBeNull();
        seen.push(...ids(page));
      }
      return seen;
    }

    expect(await all('q=lesson')).toEqual([7, 6, 5, 4, 3, 2, 1]);
    expect(await all('q=notes&sort=newest')).toEqual([7, 6, 5, 4, 3, 2, 1]);
    expect(await all('q=pdf&sort=oldest')).toEqual([1, 2, 3, 4, 5, 6, 7]);

    const first = await search('q=lesson&limit=3');
    expectApiError(
      await get(
        `/api/search?q=lesson&sort=oldest&cursor=${encodeURIComponent(first.nextCursor ?? '')}`,
      ),
      400,
      'INVALID_CURSOR',
    );
    expectApiError(await get('/api/search?q=lesson&cursor=nonsense'), 400, 'INVALID_CURSOR');
  });

  it('takes the same filters as the message list', async () => {
    const channel = await addChannel({ isForum: true });
    const oldGroup = await addChannel({ type: 'GROUP', migratedToChannelId: channel.id });
    const other = await addChannel();
    const rows: Message[] = [
      await addMessage(oldGroup, 1, { text: 'kit one' }),
      await addMessage(channel, 2, {}, { fileName: 'kit-2.mp4', status: 'DOWNLOADED' }),
      await addMessage(channel, 3, { threadId: 3 }, { fileName: 'kit-3.mp4', type: 'VIDEO' }),
      await addMessage(channel, 4, { threadId: 3 }, { fileName: 'kit-4.pdf', type: 'DOCUMENT' }),
      await addMessage(channel, 5, { type: 'SERVICE', text: 'kit topic' }),
      await addMessage(other, 6, { text: 'kit six' }),
      await addMessage(other, 7, {}, { fileName: 'kit-7.jpg', type: 'PHOTO' }),
    ];
    const [red, blue] = await Promise.all(
      ['Red', 'Blue'].map((name) =>
        prisma.tag.create({ data: { name, nameNormalized: name.toLowerCase() } }),
      ),
    );
    const byId = (id: number) => rows[id - 1]?.id ?? '';
    await prisma.messageTag.createMany({
      data: [
        { messageId: byId(2), tagId: red?.id ?? '' },
        { messageId: byId(2), tagId: blue?.id ?? '' },
        { messageId: byId(6), tagId: red?.id ?? '' },
      ],
    });
    await prisma.message.updateMany({
      where: { id: { in: [byId(3), byId(7)] } },
      data: { isFavorite: true, favoritedAt: new Date() },
    });

    const filters = [
      '',
      `channelId=${channel.id}`,
      `channelId=${channel.id}&topicId=3`,
      `channelId=${channel.id}&topicId=1`,
      'types=VIDEO,DOCUMENT',
      'types=SERVICE',
      'from=2026-01-01T12:00:00%2B00:00&to=2026-01-02',
      'downloaded=true',
      'downloaded=false',
      `tagIds=${red?.id}`,
      `tagIds=${red?.id},${blue?.id}`,
      'favorite=true',
      'favorite=false',
    ];
    for (const filter of filters) {
      const expected = ids(await list(filter));
      expect(ids(await search(`q=kit&sort=newest&${filter}`)), filter).toEqual(expected);
    }
    expect(ids(await search(`q=kit&tagIds=${red?.id},${blue?.id}`))).toEqual([2]);
  });

  it('refuses queries without words and unknown channels', async () => {
    for (const query of ['', 'q=', 'q=%20%20', 'q=%23%21%3F', `q=${'a'.repeat(201)}`]) {
      expectApiError(await get(`/api/search?${query}`), 400, 'VALIDATION_FAILED');
    }
    expectApiError(await get('/api/search?q=x&topicId=4'), 400, 'VALIDATION_FAILED');
    expectApiError(
      await get('/api/search?q=x&channelId=0199a0b1-0000-7000-8000-000000000404'),
      404,
      'NOT_FOUND',
    );
  });
});
