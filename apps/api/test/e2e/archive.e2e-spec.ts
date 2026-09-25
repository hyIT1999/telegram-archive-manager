import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Channel, DownloadStatus, MediaType, PrismaClient } from '@tam/database';
import { STATS_KEYS, type ChannelDto, type Page, type StatsDto } from '@tam/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestPrisma, insertUser, resetDatabase } from './support/database.js';
import { expectApiError, nextClientIp, sessionCookie } from './support/http.js';
import { createTestApp } from './support/test-app.js';

const EMAIL = 'archivist@example.test';
const PASSWORD = 'correct horse battery staple';

describe('channels and stats (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let cookie: string;

  const http = () => request(app.getHttpServer());
  const get = (path: string) => http().get(path).set('Cookie', cookie);

  beforeAll(async () => {
    prisma = createTestPrisma();
    await resetDatabase(prisma);
    await insertUser(prisma, EMAIL, PASSWORD);
    app = await createTestApp();
    const login = await http()
      .post('/api/auth/login')
      .set('X-Forwarded-For', nextClientIp())
      .send({ email: EMAIL, password: PASSWORD })
      .expect(200);
    cookie = sessionCookie(login);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it.each(['/api/channels', `/api/channels/${randomUUID()}`, '/api/stats'])(
    'GET %s requires a session',
    async (path) => {
      expectApiError(await http().get(path), 401, 'UNAUTHENTICATED');
    },
  );

  describe('with an empty archive', () => {
    it('GET /api/channels returns an empty page', async () => {
      const response = await get('/api/channels').expect(200);
      expect(response.body).toEqual({ items: [], nextCursor: null });
    });

    it('GET /api/stats returns every STATS_KEYS entry as 0', async () => {
      const response = await get('/api/stats').expect(200);
      const stats = response.body as StatsDto;
      expect(Object.keys(stats).sort()).toEqual([...STATS_KEYS].sort());
      for (const key of STATS_KEYS) {
        expect(stats[key]).toBe(0);
      }
    });
  });

  describe('with archived channels', () => {
    // Channels in the expected listing order: createdAt desc, then id desc on ties.
    let history: Channel;
    let math: Channel;
    let physics: Channel;
    let legacyGroup: Channel;
    let listed: Channel[];

    /** One message per distinct message id, each with its media rows. */
    async function seedMessages(
      channel: Channel,
      media: [number, MediaType, DownloadStatus, bigint | null][],
    ) {
      const messageIds = [...new Set(media.map(([messageId]) => messageId))];
      for (const telegramMessageId of messageIds) {
        await prisma.message.create({
          data: {
            channelId: channel.id,
            telegramMessageId,
            type: 'TEXT',
            text: `message ${telegramMessageId}`,
            telegramDate: new Date('2026-01-01T00:00:00Z'),
            media: {
              create: media
                .filter(([messageId]) => messageId === telegramMessageId)
                .map(([messageId, type, downloadStatus, size], index) => ({
                  telegramFileId: `${channel.telegramChatId}:${messageId}:f${index}`,
                  telegramFileUniqueId: `f-${channel.id}-${messageId}-${index}`,
                  type,
                  downloadStatus,
                  size,
                })),
            },
          },
        });
      }
    }

    beforeAll(async () => {
      history = await prisma.channel.create({
        data: {
          // Beyond Number.MAX_SAFE_INTEGER: must reach the client as an exact string.
          telegramChatId: -1_009_007_199_254_740_993n,
          accessHash: 987_654_321_987_654_321n,
          title: 'Lịch sử Việt Nam',
          username: 'lichsu',
          type: 'CHANNEL',
          createdAt: new Date('2026-01-01T00:00:00Z'),
        },
      });
      // math and physics share createdAt, so the id tie-breaker decides their order.
      math = await prisma.channel.create({
        data: {
          telegramChatId: -1_001_000_000_002n,
          title: 'Toán học',
          username: 'toanhoc',
          type: 'SUPERGROUP',
          createdAt: new Date('2026-01-02T00:00:00Z'),
        },
      });
      physics = await prisma.channel.create({
        data: {
          telegramChatId: -1_001_000_000_003n,
          title: 'Vật lý',
          type: 'CHANNEL',
          createdAt: new Date('2026-01-02T00:00:00Z'),
        },
      });
      legacyGroup = await prisma.channel.create({
        data: {
          telegramChatId: -4_000_000_001n,
          title: 'Toán học (nhóm cũ)',
          type: 'GROUP',
          migratedToChannelId: math.id,
          createdAt: new Date('2026-01-04T00:00:00Z'),
        },
      });
      listed = [legacyGroup, ...[math, physics].sort((a, b) => (a.id < b.id ? 1 : -1)), history];

      await seedMessages(history, [
        [1, 'VIDEO', 'DOWNLOADED', 1_000n],
        [1, 'PHOTO', 'PENDING', 300n],
        [2, 'DOCUMENT', 'FAILED', 700n],
        [2, 'AUDIO', 'DOWNLOADING', 500n],
        [3, 'VOICE', 'DOWNLOADED', 250n],
        [3, 'STICKER', 'SKIPPED', null],
      ]);
      await seedMessages(math, [[10, 'ANIMATION', 'DOWNLOADED', 4_000n]]);
      await prisma.message.create({
        data: { channelId: math.id, telegramMessageId: 11, type: 'TEXT', telegramDate: new Date() },
      });
      await seedMessages(legacyGroup, [[10, 'PHOTO', 'DOWNLOADED', 50n]]);
    });

    it('GET /api/stats aggregates the whole archive (legacy groups are not channels)', async () => {
      const response = await get('/api/stats').expect(200);
      expect(response.body).toEqual({
        channels: 3,
        messages: 6,
        videos: 2,
        images: 3,
        documents: 1,
        audio: 2,
        storageBytes: 5_300,
        downloaded: 4,
        pending: 2,
        failed: 1,
      });
    });

    it('GET /api/channels lists newest first with per-channel stats and string ids', async () => {
      const response = await get('/api/channels').expect(200);
      const page = response.body as Page<ChannelDto>;
      expect(page.nextCursor).toBeNull();
      expect(page.items.map((channel) => channel.id)).toEqual(listed.map((channel) => channel.id));

      const byId = new Map(page.items.map((channel) => [channel.id, channel]));
      expect(byId.get(history.id)).toEqual({
        id: history.id,
        telegramChatId: '-1009007199254740993',
        title: 'Lịch sử Việt Nam',
        username: 'lichsu',
        type: 'CHANNEL',
        isProtected: false,
        isForum: false,
        memberCount: null,
        syncEnabled: false,
        headMessageId: null,
        backfillComplete: false,
        lastSyncedAt: null,
        migratedToChannelId: null,
        storageLocation: null,
        storageFolder: null,
        downloadMedia: true,
        downloadNote: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: expect.any(String),
        stats: { messages: 3, media: 6, downloadedMedia: 2, storageBytes: 1_250 },
      });
      expect(byId.get(math.id)?.stats).toEqual({
        messages: 2,
        media: 1,
        downloadedMedia: 1,
        storageBytes: 4_000,
      });
      expect(byId.get(physics.id)?.stats).toEqual({
        messages: 0,
        media: 0,
        downloadedMedia: 0,
        storageBytes: 0,
      });
      expect(byId.get(legacyGroup.id)).toMatchObject({
        migratedToChannelId: math.id,
        stats: { messages: 1, media: 1, downloadedMedia: 1, storageBytes: 50 },
      });
      expect(JSON.stringify(page)).not.toContain('accessHash');
    });

    it('pages with an opaque cursor across a createdAt tie', async () => {
      const first = (await get('/api/channels?limit=2').expect(200)).body as Page<ChannelDto>;
      expect(first.items.map((channel) => channel.id)).toEqual(
        listed.slice(0, 2).map((channel) => channel.id),
      );
      expect(first.nextCursor).toEqual(expect.any(String));

      const second = (await get(`/api/channels?limit=2&cursor=${first.nextCursor}`).expect(200))
        .body as Page<ChannelDto>;
      expect(second.items.map((channel) => channel.id)).toEqual(
        listed.slice(2).map((channel) => channel.id),
      );
      expect(second.nextCursor).toBeNull();
    });

    it('filters by title or username, case-insensitively', async () => {
      const byUsername = (await get('/api/channels?q=LICHSU').expect(200)).body as Page<ChannelDto>;
      expect(byUsername.items.map((channel) => channel.id)).toEqual([history.id]);

      const byTitle = (await get(`/api/channels?q=${encodeURIComponent('toán')}`).expect(200))
        .body as Page<ChannelDto>;
      expect(byTitle.items.map((channel) => channel.id).sort()).toEqual(
        [math.id, legacyGroup.id].sort(),
      );
    });

    it('rejects invalid list parameters with 400', async () => {
      expectApiError(await get('/api/channels?limit=0'), 400, 'VALIDATION_FAILED');
      expectApiError(await get('/api/channels?limit=101'), 400, 'VALIDATION_FAILED');
      expectApiError(await get('/api/channels?cursor=bm90LWEtY3Vyc29y'), 400, 'INVALID_CURSOR');
    });

    it('GET /api/channels/:id returns one channel with its stats', async () => {
      const response = await get(`/api/channels/${math.id}`).expect(200);
      expect(response.body).toMatchObject({
        id: math.id,
        telegramChatId: '-1001000000002',
        type: 'SUPERGROUP',
        stats: { messages: 2, media: 1, downloadedMedia: 1, storageBytes: 4_000 },
      });
    });

    it('GET /api/channels/:id answers 404 for an unknown id and 400 for a malformed one', async () => {
      expectApiError(await get(`/api/channels/${randomUUID()}`), 404, 'NOT_FOUND');
      const malformed = expectApiError(
        await get('/api/channels/not-a-uuid'),
        400,
        'VALIDATION_FAILED',
      );
      expect(malformed.details).toEqual([{ path: 'id', message: expect.any(String) }]);
    });
  });
});
