import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, type PrismaClient } from '../../src/index.js';

let prisma: PrismaClient;
let chatSeq = 0n;

beforeAll(() => {
  prisma = createPrismaClient({
    url: inject('databaseUrl'),
    max: 4,
    applicationName: 'tam-db-tests',
  });
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

function messageRow(
  channelId: string,
  telegramMessageId: number,
  extra: { text?: string; caption?: string } = {},
) {
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
    expect(channel.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    const message = await prisma.message.create({ data: messageRow(channel.id, 1) });
    await prisma.media.create({
      data: {
        messageId: message.id,
        telegramFileId: 'x',
        telegramFileUniqueId: 'u',
        type: 'PHOTO',
      },
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
    const message = await prisma.message.create({
      data: messageRow(channel.id, 200, { text: nfdText }),
    });

    expect(await searchIds('tài liệu')).toContain(message.id);
    expect(await searchIds('tai lieu'.normalize('NFD'))).toContain(message.id);
  });

  it('recomputes search_vector only when text or caption change', async () => {
    const channel = await newChannel();
    const message = await prisma.message.create({
      data: messageRow(channel.id, 300, { text: 'alpha' }),
    });

    // A sentinel written directly survives updates of other columns (trigger does not fire)…
    await prisma.$executeRaw`UPDATE messages SET search_vector = to_tsvector('simple', 'sentinel') WHERE id = ${message.id}::uuid`;
    await prisma.message.update({
      where: { id: message.id },
      data: { isFavorite: true, views: 42 },
    });
    expect(await searchIds('sentinel')).toContain(message.id);

    // …and is replaced as soon as the caption changes.
    await prisma.message.update({ where: { id: message.id }, data: { caption: 'beta' } });
    expect(await searchIds('sentinel')).not.toContain(message.id);
    expect(await searchIds('alpha beta')).toContain(message.id);
  });
});

describe('file names in the search document', () => {
  function fileRow(messageId: string, filename: string, uniqueId: string) {
    return {
      messageId,
      telegramFileId: 'f',
      telegramFileUniqueId: uniqueId,
      type: 'VIDEO' as const,
      filename,
    };
  }

  it('finds a message by the words of its file name, split at dots and underscores', async () => {
    const channel = await newChannel();
    const message = await prisma.message.create({
      data: { ...messageRow(channel.id, 500), type: 'VIDEO' },
    });
    expect(await searchIds('zone')).not.toContain(message.id);

    // Stored after the message, as imports do.
    await prisma.media.create({
      data: fileRow(message.id, 'Phương_Pháp_02_Time_Zone.mp4', 'doc-500'),
    });

    expect(await searchIds('zone')).toContain(message.id);
    expect(await searchIds('phuong phap 02')).toContain(message.id);
    expect(await searchIds('mp4')).toContain(message.id);
  });

  it('keeps file names when the caption changes, and follows a renamed file', async () => {
    const channel = await newChannel();
    const message = await prisma.message.create({
      data: { ...messageRow(channel.id, 501), type: 'PHOTO' },
    });
    const media = await prisma.media.create({
      data: fileRow(message.id, 'IMG_20240101.jpg', 'doc-501'),
    });
    expect(await searchIds('20240101')).toContain(message.id);

    await prisma.message.update({
      where: { id: message.id },
      data: { caption: 'Harbour at dawn' },
    });
    expect(await searchIds('harbour 20240101')).toContain(message.id);

    await prisma.media.update({ where: { id: media.id }, data: { filename: 'sunrise.jpg' } });
    expect(await searchIds('sunrise harbour')).toContain(message.id);
    expect(await searchIds('20240101')).not.toContain(message.id);
  });

  it('computes what the triggers store, and leaves updated_at alone', async () => {
    const channel = await newChannel();
    const message = await prisma.message.create({
      data: { ...messageRow(channel.id, 502, { caption: 'Lecture notes' }), type: 'DOCUMENT' },
    });
    await prisma.media.create({ data: fileRow(message.id, 'week_3.pdf', 'doc-502') });

    // The migration backfills older messages with this same function.
    const [row] = await prisma.$queryRaw<{ same: boolean; vector: string }[]>`
      SELECT search_vector = messages_search_document(id, text, caption) AS same, search_vector::text AS vector
      FROM messages WHERE id = ${message.id}::uuid`;
    expect(row?.same).toBe(true);
    expect(row?.vector).toContain("'week':3A");
    const after = await prisma.message.findUniqueOrThrow({ where: { id: message.id } });
    expect(after.updatedAt).toEqual(message.updatedAt);
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

describe('download queue columns', () => {
  async function fileIn(channelId: string, messageId: number, size: bigint | null) {
    const message = await prisma.message.create({ data: messageRow(channelId, messageId) });
    return prisma.media.create({
      data: {
        messageId: message.id,
        telegramFileId: `chat:${messageId}:q-${messageId}`,
        telegramFileUniqueId: `q-${messageId}`,
        type: 'VIDEO',
        size,
      },
    });
  }

  it('gives every download job the channel and size of its file, whoever inserts it', async () => {
    const channel = await newChannel('Queue');
    const [small, unknown] = [
      await fileIn(channel.id, 1, 5_000n),
      await fileIn(channel.id, 2, null),
    ];
    await prisma.downloadJob.createMany({ data: [{ mediaId: small.id }] });
    await prisma.$executeRaw`INSERT INTO download_jobs (media_id) VALUES (${unknown.id}::uuid)`;

    const jobs = await prisma.downloadJob.findMany({
      where: { mediaId: { in: [small.id, unknown.id] } },
      orderBy: { size: 'asc' },
      select: { mediaId: true, channelId: true, size: true },
    });
    expect(jobs).toEqual([
      { mediaId: small.id, channelId: channel.id, size: 5_000n },
      { mediaId: unknown.id, channelId: channel.id, size: null },
    ]);
  });

  it('follows a corrected file size, and ignores what a writer claims', async () => {
    const channel = await newChannel('Sizes');
    const other = await newChannel('Elsewhere');
    const media = await fileIn(channel.id, 3, 1_000n);
    await prisma.downloadJob.create({ data: { mediaId: media.id, channelId: other.id, size: 7n } });
    expect(
      await prisma.downloadJob.findUniqueOrThrow({ where: { mediaId: media.id } }),
    ).toMatchObject({ channelId: channel.id, size: 1_000n });

    await prisma.media.update({ where: { id: media.id }, data: { size: 2_500n } });
    expect(
      (await prisma.downloadJob.findUniqueOrThrow({ where: { mediaId: media.id } })).size,
    ).toBe(2_500n);
  });
});
