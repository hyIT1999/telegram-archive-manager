import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, type PrismaClient } from '../../src/index.js';

let prisma: PrismaClient;
let chatSeq = 0n;

beforeAll(() => {
  prisma = createPrismaClient({ url: inject('databaseUrl'), max: 4, applicationName: 'tam-db-tests' });
});

afterAll(async () => {
  await prisma.$disconnect();
});

function newChannel(title = 'Channel') {
  chatSeq += 1n;
  return prisma.channel.create({
    data: { telegramChatId: -1_000_000_000_000n - chatSeq, title, type: 'CHANNEL' },
  });
}

function messageRow(channelId: string, telegramMessageId: number, extra: { text?: string; caption?: string } = {}) {
  return {
    channelId,
    telegramMessageId,
    type: 'TEXT' as const,
    telegramDate: new Date('2025-01-01T00:00:00Z'),
    ...extra,
  };
}

async function searchIds(query: string): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id::text AS id FROM messages
    WHERE search_vector @@ websearch_to_tsquery('public.tam_simple', normalize(${query}, NFC))`;
  return rows.map((row) => row.id);
}

describe('idempotent message storage', () => {
  it('ignores a re-imported page and rejects a direct duplicate', async () => {
    const channel = await newChannel();
    const page = [1, 2, 3].map((id) => messageRow(channel.id, id, { text: `m${id}` }));

    const first = await prisma.message.createMany({ data: page, skipDuplicates: true });
    const second = await prisma.message.createMany({ data: page, skipDuplicates: true });

    expect(first.count).toBe(3);
    expect(second.count).toBe(0);
    expect(await prisma.message.count({ where: { channelId: channel.id } })).toBe(3);
    await expect(prisma.message.create({ data: messageRow(channel.id, 2) })).rejects.toMatchObject({
      code: 'P2002',
    });
  });

  it('allows the same telegram message id in different channels (migrated basic groups)', async () => {
    const supergroup = await newChannel('Supergroup');
    const legacy = await newChannel('Legacy basic group');
    await prisma.message.create({ data: messageRow(supergroup.id, 57) });
    await prisma.message.create({ data: messageRow(legacy.id, 57) });
    expect(await prisma.message.count({ where: { telegramMessageId: 57 } })).toBe(2);
  });

  it('stores one media row per (message, file_unique_id) and one download job per media', async () => {
    const channel = await newChannel();
    const message = await prisma.message.create({ data: messageRow(channel.id, 10) });
    const media = {
      messageId: message.id,
      telegramFileId: `chat:10:uid-1`,
      telegramFileUniqueId: 'uid-1',
      type: 'VIDEO' as const,
      filename: 'lesson.mp4',
    };
    await prisma.media.createMany({ data: [media], skipDuplicates: true });
    await prisma.media.createMany({ data: [media], skipDuplicates: true });
    const rows = await prisma.media.findMany({ where: { messageId: message.id } });
    expect(rows).toHaveLength(1);

    const mediaId = rows[0]!.id;
    await prisma.downloadJob.createMany({ data: [{ mediaId }], skipDuplicates: true });
    await prisma.downloadJob.createMany({ data: [{ mediaId }], skipDuplicates: true });
    expect(await prisma.downloadJob.count({ where: { mediaId } })).toBe(1);
  });

  it('generates uuid v7 ids in the database and cascades channel deletion', async () => {
    const channel = await newChannel();
    expect(channel.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    const message = await prisma.message.create({ data: messageRow(channel.id, 1) });
    await prisma.media.create({
      data: { messageId: message.id, telegramFileId: 'x', telegramFileUniqueId: 'u', type: 'PHOTO' },
    });
    await prisma.channel.delete({ where: { id: channel.id } });
    expect(await prisma.message.count({ where: { channelId: channel.id } })).toBe(0);
    expect(await prisma.media.count({ where: { messageId: message.id } })).toBe(0);
  });
});

describe('one active import job per channel', () => {
  it('rejects a second active job and allows a new one once the first is terminal', async () => {
    const channel = await newChannel();
    const job = await prisma.importJob.create({ data: { channelId: channel.id } });

    await expect(
      prisma.importJob.create({ data: { channelId: channel.id, status: 'PAUSED' } }),
    ).rejects.toMatchObject({ code: 'P2002' });

    await prisma.importJob.update({ where: { id: job.id }, data: { status: 'COMPLETED' } });
    const next = await prisma.importJob.create({ data: { channelId: channel.id, type: 'SYNC' } });
    expect(next.status).toBe('PENDING');

    // Terminal jobs never block each other.
    await prisma.importJob.update({ where: { id: next.id }, data: { status: 'CANCELLED' } });
    await prisma.importJob.create({ data: { channelId: channel.id, status: 'FAILED' } });
    expect(await prisma.importJob.count({ where: { channelId: channel.id } })).toBe(3);
  });
});

describe('accent-insensitive full-text search', () => {
  it('finds Vietnamese text without diacritics, in text and caption', async () => {
    const channel = await newChannel();
    const inText = await prisma.message.create({
      data: messageRow(channel.id, 100, { text: 'Học lập trình Angular cơ bản' }),
    });
    const inCaption = await prisma.message.create({
      data: messageRow(channel.id, 101, { caption: 'Bài giảng TypeScript nâng cao' }),
    });

    expect(await searchIds('hoc lap trinh')).toContain(inText.id);
    expect(await searchIds('học')).toContain(inText.id);
    expect(await searchIds('bai giang')).toContain(inCaption.id);
    expect(await searchIds('"nang cao" typescript')).toContain(inCaption.id);
    expect(await searchIds('python')).not.toContain(inText.id);
  });

  it('indexes decomposed (NFD) input the same as precomposed text', async () => {
    const channel = await newChannel();
    const nfdText = 'Tài liệu học tập'.normalize('NFD');
    expect(nfdText).not.toBe(nfdText.normalize('NFC'));
    const message = await prisma.message.create({ data: messageRow(channel.id, 200, { text: nfdText }) });

    expect(await searchIds('tài liệu')).toContain(message.id);
    expect(await searchIds('tai lieu'.normalize('NFD'))).toContain(message.id);
  });

  it('recomputes search_vector only when text or caption change', async () => {
    const channel = await newChannel();
    const message = await prisma.message.create({ data: messageRow(channel.id, 300, { text: 'alpha' }) });

    // A sentinel written directly survives updates of other columns (trigger does not fire)…
    await prisma.$executeRaw`UPDATE messages SET search_vector = to_tsvector('simple', 'sentinel') WHERE id = ${message.id}::uuid`;
    await prisma.message.update({ where: { id: message.id }, data: { isFavorite: true, views: 42 } });
    expect(await searchIds('sentinel')).toContain(message.id);

    // …and is replaced as soon as the caption changes.
    await prisma.message.update({ where: { id: message.id }, data: { caption: 'beta' } });
    expect(await searchIds('sentinel')).not.toContain(message.id);
    expect(await searchIds('alpha beta')).toContain(message.id);
  });
});

describe('filename search', () => {
  it('matches filenames by substring through the trigram index', async () => {
    const channel = await newChannel();
    const message = await prisma.message.create({ data: messageRow(channel.id, 400) });
    const media = await prisma.media.create({
      data: {
        messageId: message.id,
        telegramFileId: 'f',
        telegramFileUniqueId: 'trgm-1',
        type: 'DOCUMENT',
        filename: 'Bai_giang_Angular_2025.pdf',
      },
    });

    const found = await prisma.media.findMany({
      where: { filename: { contains: 'angular_20', mode: 'insensitive' } },
      select: { id: true },
    });
    expect(found.map((row) => row.id)).toContain(media.id);

    const indexes = await prisma.$queryRaw<{ indexdef: string }[]>`
      SELECT indexdef FROM pg_indexes WHERE indexname = 'media_filename_trgm_idx'`;
    expect(indexes[0]?.indexdef).toContain('gin_trgm_ops');
  });
});
