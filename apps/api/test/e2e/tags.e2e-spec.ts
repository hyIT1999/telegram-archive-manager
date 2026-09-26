import type { NestExpressApplication } from '@nestjs/platform-express';
import type { PrismaClient } from '@tam/database';
import {
  type FavoriteDto,
  MAX_TAGS,
  type MessageDto,
  type MessagePageDto,
  type MessageTagsDto,
  type TagDto,
  type TagListDto,
} from '@tam/shared';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { archiveRows } from './support/archive-rows.js';
import { createTestPrisma, insertUser } from './support/database.js';
import { expectApiError, nextClientIp, sessionCookie } from './support/http.js';
import { createTestApp } from './support/test-app.js';

const EMAIL = 'tagger@example.test';
const PASSWORD = 'correct horse battery staple';
const UNKNOWN = '0199a0b1-0000-7000-8000-000000000404';

describe('tags and favorites (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let cookie: string;

  const http = () => request(app.getHttpServer());
  const get = (path: string) => http().get(path).set('Cookie', cookie);
  const send = (method: 'post' | 'patch' | 'delete', path: string, body: object = {}) =>
    http()[method](path).set('Cookie', cookie).set('X-Forwarded-For', nextClientIp()).send(body);
  const list = async (query: string) =>
    (await get(`/api/messages?${query}`).expect(200)).body as MessagePageDto;
  const ids = (page: MessagePageDto) => page.items.map((item) => item.telegramMessageId);
  const tagNames = async () =>
    ((await get('/api/tags').expect(200)).body as TagListDto).items.map((tag) => tag.name);
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

  it.each([
    ['get', '/api/tags'],
    ['post', `/api/messages/${UNKNOWN}/favorite`],
    ['post', `/api/messages/${UNKNOWN}/tags`],
  ] as const)('%s %s requires a session', async (method, path) => {
    expectApiError(await http()[method](path), 401, 'UNAUTHENTICATED');
  });

  describe('tags', () => {
    it('creates, lists, renames, recolors and deletes tags', async () => {
      const created = await send('post', '/api/tags', {
        name: '  Quan   trọng ',
        color: '#E53935',
      });
      expect(created.status).toBe(201);
      const important = created.body as TagDto;
      expect(important).toMatchObject({ name: 'Quan trọng', color: '#e53935', messageCount: 0 });

      // Names are unique without regard to case or Unicode form.
      for (const name of ['QUAN TRỌNG', 'Quan trọng'.normalize('NFD')]) {
        expectApiError(await send('post', '/api/tags', { name }), 409, 'TAG_NAME_TAKEN');
      }
      const alpha = (await send('post', '/api/tags', { name: 'Alpha' }).expect(201)).body as TagDto;
      expect(alpha.color).toBeNull();
      expect(await tagNames()).toEqual(['Alpha', 'Quan trọng']);

      expectApiError(
        await send('patch', `/api/tags/${alpha.id}`, { name: 'quan TRỌNG' }),
        409,
        'TAG_NAME_TAKEN',
      );
      expect(
        (
          await send('patch', `/api/tags/${alpha.id}`, { name: 'Beta', color: '#00897b' }).expect(
            200,
          )
        ).body,
      ).toMatchObject({ id: alpha.id, name: 'Beta', color: '#00897b' });
      expect(
        (await send('patch', `/api/tags/${important.id}`, { color: null }).expect(200)).body,
      ).toMatchObject({ name: 'Quan trọng', color: null });
      expectApiError(await send('patch', `/api/tags/${alpha.id}`, {}), 400, 'VALIDATION_FAILED');
      expectApiError(await send('patch', `/api/tags/${UNKNOWN}`, { name: 'X' }), 404, 'NOT_FOUND');

      await send('delete', `/api/tags/${alpha.id}`).expect(204);
      expectApiError(await send('delete', `/api/tags/${alpha.id}`), 404, 'NOT_FOUND');
      expect(await tagNames()).toEqual(['Quan trọng']);
      expectApiError(await send('post', '/api/tags', { name: '   ' }), 400, 'VALIDATION_FAILED');
    });

    it('tags a message by tag or by name, and takes tags off', async () => {
      const channel = await addChannel();
      const message = await addMessage(channel, 1);
      const path = `/api/messages/${message.id}/tags`;

      const byName = (await send('post', path, { name: 'Physics', color: '#3949ab' }).expect(200))
        .body as MessageTagsDto;
      expect(byName.tags).toEqual([{ id: expect.any(String), name: 'Physics', color: '#3949ab' }]);
      const physics = byName.tags[0]?.id ?? '';
      // The same name again (any case) is the same tag, carried once.
      expect(
        ((await send('post', path, { name: 'PHYSICS' }).expect(200)).body as MessageTagsDto).tags,
      ).toHaveLength(1);

      const basics = (await send('post', '/api/tags', { name: 'Basics' }).expect(201))
        .body as TagDto;
      const both = (await send('post', path, { tagId: basics.id }).expect(200))
        .body as MessageTagsDto;
      expect(both.tags.map((tag) => tag.name)).toEqual(['Basics', 'Physics']);

      const detail = (await get(`/api/messages/${message.id}`).expect(200)).body as MessageDto;
      expect(detail.tags.map((tag) => tag.name)).toEqual(['Basics', 'Physics']);
      expect((await list('')).items[0]?.tags).toHaveLength(2);
      const counts = ((await get('/api/tags').expect(200)).body as TagListDto).items;
      expect(counts.map((tag) => [tag.name, tag.messageCount])).toEqual([
        ['Basics', 1],
        ['Physics', 1],
      ]);

      const untagged = (await send('delete', `${path}/${physics}`).expect(200))
        .body as MessageTagsDto;
      expect(untagged.tags.map((tag) => tag.name)).toEqual(['Basics']);
      // Taking off a tag the message does not carry changes nothing.
      await send('delete', `${path}/${physics}`).expect(200);

      // Deleting a tag takes it off its messages.
      await send('delete', `/api/tags/${basics.id}`).expect(204);
      expect(((await get(`/api/messages/${message.id}`)).body as MessageDto).tags).toEqual([]);

      expectApiError(await send('post', path, { tagId: UNKNOWN }), 404, 'NOT_FOUND');
      expectApiError(await send('post', path, { tagId: 'nope' }), 400, 'VALIDATION_FAILED');
      expectApiError(
        await send('post', `/api/messages/${UNKNOWN}/tags`, { name: 'x' }),
        404,
        'NOT_FOUND',
      );
    });

    it('lists the messages that carry every chosen tag', async () => {
      const channel = await addChannel();
      const [first, second] = [await addMessage(channel, 1), await addMessage(channel, 2)];
      await addMessage(channel, 3);
      const red = (await send('post', '/api/tags', { name: 'Red' }).expect(201)).body as TagDto;
      const blue = (await send('post', '/api/tags', { name: 'Blue' }).expect(201)).body as TagDto;
      for (const [message, tag] of [
        [first, red],
        [first, blue],
        [second, red],
      ] as const) {
        await send('post', `/api/messages/${message.id}/tags`, { tagId: tag.id }).expect(200);
      }

      expect(ids(await list(`tagIds=${red.id}`))).toEqual([2, 1]);
      expect(ids(await list(`tagIds=${red.id},${blue.id}`))).toEqual([1]);
      expect(ids(await list(`tagIds=${blue.id}&favorite=false`))).toEqual([1]);
    });

    it(`stops at ${MAX_TAGS} tags`, async () => {
      await prisma.tag.createMany({
        data: Array.from({ length: MAX_TAGS }, (_, index) => ({
          name: `Tag ${index}`,
          nameNormalized: `tag ${index}`,
        })),
      });
      expectApiError(
        await send('post', '/api/tags', { name: 'One more' }),
        422,
        'TAG_LIMIT_REACHED',
      );

      const channel = await addChannel();
      const message = await addMessage(channel, 1);
      const path = `/api/messages/${message.id}/tags`;
      expectApiError(await send('post', path, { name: 'One more' }), 422, 'TAG_LIMIT_REACHED');
      // An existing name needs no room.
      await send('post', path, { name: 'tag 7' }).expect(200);
    });
  });

  describe('favorites', () => {
    it('favorites a message once and keeps the first date', async () => {
      const channel = await addChannel();
      const message = await addMessage(channel, 1);
      await addMessage(channel, 2);
      const path = `/api/messages/${message.id}/favorite`;

      const added = (await send('post', path).expect(200)).body as FavoriteDto;
      expect(added).toEqual({ isFavorite: true, favoritedAt: expect.any(String) });
      expect((await send('post', path).expect(200)).body).toEqual(added);

      const detail = (await get(`/api/messages/${message.id}`).expect(200)).body as MessageDto;
      expect(detail).toMatchObject({ isFavorite: true, favoritedAt: added.favoritedAt });
      expect(ids(await list('favorite=true'))).toEqual([1]);
      expect(ids(await list('favorite=false'))).toEqual([2]);

      const removed = { isFavorite: false, favoritedAt: null };
      expect((await send('delete', path).expect(200)).body).toEqual(removed);
      expect((await send('delete', path).expect(200)).body).toEqual(removed);
      expectApiError(await send('post', `/api/messages/${UNKNOWN}/favorite`), 404, 'NOT_FOUND');
    });

    it('lists favorites by the date they were favorited, page by page', async () => {
      const channel = await addChannel();
      const messages = [
        await addMessage(channel, 1),
        await addMessage(channel, 2),
        await addMessage(channel, 3),
      ];
      // Favorited in the order 1, 3, 2.
      for (const [index, day] of [
        [0, 1],
        [2, 2],
        [1, 3],
      ] as const) {
        await prisma.message.update({
          where: { id: messages[index]?.id ?? '' },
          data: { isFavorite: true, favoritedAt: new Date(Date.UTC(2026, 5, day)) },
        });
      }

      const seen: number[] = [];
      let page = await list('favorite=true&sort=favorited&limit=2');
      seen.push(...ids(page));
      while (page.nextCursor) {
        page = await list(
          `favorite=true&sort=favorited&limit=2&cursor=${encodeURIComponent(page.nextCursor)}`,
        );
        seen.push(...ids(page));
      }
      expect(seen).toEqual([2, 3, 1]);
      expectApiError(await get('/api/messages?sort=favorited'), 400, 'VALIDATION_FAILED');
    });
  });
});
