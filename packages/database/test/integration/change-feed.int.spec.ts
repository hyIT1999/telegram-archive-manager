import { afterAll, beforeAll, beforeEach, describe, expect, inject, it, vi } from 'vitest';
import {
  type ChangeListener,
  type PrismaClient,
  createImportJob,
  createPrismaClient,
  listenForChanges,
} from '../../src/index.js';

const LISTENER_NAME = 'tam-db-tests-listener';

let prisma: PrismaClient;
let listener: ChangeListener;
/** Payloads in the order they arrived. */
const received: string[] = [];
/** One entry per time LISTEN became active: false at first, true after a reconnection. */
const listening: boolean[] = [];
let markerId: string;
let markerRound = 0;
let chatSeq = 0n;

beforeAll(async () => {
  const url = inject('databaseUrl');
  prisma = createPrismaClient({ url, max: 4, applicationName: 'tam-db-tests-changes' });
  listener = listenForChanges({
    connectionString: url,
    applicationName: LISTENER_NAME,
    onChange: (change) => received.push(`${change.kind}:${change.id}`),
    onListening: (resumed) => listening.push(resumed),
    minRetryMs: 50,
    maxRetryMs: 200,
  });
  await vi.waitFor(() => expect(listening).toEqual([false]));
  markerId = (await newChannel('Marker')).id;
});

afterAll(async () => {
  await listener.close();
  await prisma.$disconnect();
});

beforeEach(() => {
  received.length = 0;
});

function newChannel(title: string, extra: { migratedToChannelId?: string } = {}) {
  chatSeq += 1n;
  return prisma.channel.create({
    data: { telegramChatId: -2_000_000_000_000n - chatSeq, title, type: 'CHANNEL', ...extra },
  });
}

async function newFile(channelId: string, telegramMessageId: number) {
  const message = await prisma.message.create({
    data: {
      channelId,
      telegramMessageId,
      type: 'VIDEO',
      telegramDate: new Date('2025-01-01T00:00:00Z'),
    },
  });
  return prisma.media.create({
    data: {
      messageId: message.id,
      telegramFileId: 'f',
      telegramFileUniqueId: `u-${channelId}-${telegramMessageId}`,
      type: 'VIDEO',
    },
  });
}

/**
 * What was announced since the last call: a marker change is committed last and waited for, and
 * notifications arrive in commit order, so nothing announced before it can still be on its way.
 */
async function announced(): Promise<string[]> {
  const marker = `channel:${markerId}`;
  markerRound += 1;
  await prisma.channel.update({
    where: { id: markerId },
    data: { title: `Marker ${markerRound}` },
  });
  await vi.waitFor(() => expect(received).toContain(marker));
  return received.splice(0, received.indexOf(marker) + 1).slice(0, -1);
}

describe('change notifications', () => {
  it('announces committed import job changes once per transaction', async () => {
    const channel = await newChannel('Physics');
    const job = await prisma.importJob.create({ data: { channelId: channel.id } });
    expect(await announced()).toEqual([`job:${job.id}`]);

    await prisma.$transaction(async (tx) => {
      await tx.importJob.update({ where: { id: job.id }, data: { status: 'RUNNING' } });
      await tx.importJob.update({ where: { id: job.id }, data: { processedMessages: 100 } });
    });
    expect(await announced()).toEqual([`job:${job.id}`]);
  });

  it('says nothing about rolled-back work or updates that change nothing', async () => {
    const channel = await newChannel('Chemistry');
    const job = await prisma.importJob.create({ data: { channelId: channel.id } });
    await announced();

    await expect(
      prisma.$transaction(async (tx) => {
        await tx.importJob.update({ where: { id: job.id }, data: { processedMessages: 200 } });
        throw new Error('rolled back');
      }),
    ).rejects.toThrow('rolled back');
    await prisma.$executeRaw`UPDATE import_jobs SET total_media = total_media WHERE id = ${job.id}::uuid`;
    await prisma.$executeRaw`UPDATE channels SET title = title WHERE id = ${channel.id}::uuid`;
    expect(await announced()).toEqual([]);
  });

  it('announces channel changes but not new channels', async () => {
    const channel = await newChannel('Biology');
    expect(await announced()).toEqual([]);
    await prisma.channel.update({ where: { id: channel.id }, data: { headMessageId: 42 } });
    expect(await announced()).toEqual([`channel:${channel.id}`]);
  });

  it('announces downloads once per statement for each channel and import job they touch', async () => {
    const supergroup = await newChannel('Supergroup');
    const oldGroup = await newChannel('Old group', { migratedToChannelId: supergroup.id });
    const job = await prisma.importJob.create({ data: { channelId: supergroup.id } });
    const files = [
      await newFile(oldGroup.id, 1),
      await newFile(supergroup.id, 1),
      await newFile(supergroup.id, 2),
    ];
    await announced();
    const expected = [
      `downloads:${oldGroup.id}`,
      `downloads:${supergroup.id}`,
      `job:${job.id}`,
    ].sort();

    // The old group's file belongs to the supergroup's import; files asked for one by one have no job.
    await prisma.downloadJob.createMany({
      data: [
        { mediaId: files[0]!.id, importJobId: job.id },
        { mediaId: files[1]!.id },
        { mediaId: files[2]!.id, importJobId: job.id },
      ],
    });
    expect((await announced()).sort()).toEqual(expected);

    await prisma.downloadJob.updateMany({
      where: { mediaId: { in: files.map((file) => file.id) } },
      data: { attempts: { increment: 1 } },
    });
    expect((await announced()).sort()).toEqual(expected);

    // Only the supergroup's own file: its page, not the old group's.
    await prisma.downloadJob.updateMany({
      where: { mediaId: files[1]!.id },
      data: { progress: 50 },
    });
    expect(await announced()).toEqual([`downloads:${supergroup.id}`]);

    await prisma.downloadJob.updateMany({
      where: { mediaId: supergroup.id },
      data: { progress: 60 },
    });
    expect(await announced()).toEqual([]);
  });

  it('announces Telegram backups once per statement for each channel they touch', async () => {
    const supergroup = await newChannel('Backed up');
    const oldGroup = await newChannel('Its old group', { migratedToChannelId: supergroup.id });
    const chat = await prisma.storageLocation.create({
      data: {
        kind: 'TELEGRAM',
        name: 'Backups',
        displayPath: 'Telegram › Backups',
        target: `-100${Date.now()}`,
        config: {},
      },
    });
    const files = [await newFile(oldGroup.id, 1), await newFile(supergroup.id, 1)];
    await announced();

    await prisma.messageBackup.createMany({
      data: files.map((file, index) => ({
        messageId: file.messageId,
        storageLocationId: chat.id,
        channelId: index === 0 ? oldGroup.id : supergroup.id,
      })),
    });
    expect((await announced()).sort()).toEqual(
      [`backups:${oldGroup.id}`, `backups:${supergroup.id}`].sort(),
    );

    await prisma.messageBackup.updateMany({
      where: { channelId: supergroup.id },
      data: { uploadedBytes: 1_024n },
    });
    expect(await announced()).toEqual([`backups:${supergroup.id}`]);
  });

  it('listens again after losing its connection, and says changes may have been missed', async () => {
    await prisma.$queryRaw`
      SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name = ${LISTENER_NAME}`;
    await vi.waitFor(() => expect(listening).toEqual([false, true]));
    const channel = await newChannel('Geology');
    await prisma.channel.update({ where: { id: channel.id }, data: { headMessageId: 7 } });
    expect(await announced()).toEqual([`channel:${channel.id}`]);
  });
});

describe('import job creation', () => {
  const runJobId = (id: string, runSeq: number) => `ij-${id}-${runSeq}`;

  it('adds run 1 with its queue id, and adds nothing while the channel has an unfinished job', async () => {
    const channel = await newChannel('Astronomy');
    const job = await createImportJob(
      prisma,
      { channelId: channel.id, type: 'SYNC', origin: 'SCHEDULE', totalMessages: 12 },
      runJobId,
    );
    expect(job).toMatchObject({
      type: 'SYNC',
      origin: 'SCHEDULE',
      status: 'PENDING',
      runSeq: 1,
      totalMessages: 12,
      bullJobId: `ij-${job?.id}-1`,
    });
    expect(
      await createImportJob(prisma, { channelId: channel.id, type: 'IMPORT' }, runJobId),
    ).toBeNull();

    await prisma.importJob.update({ where: { id: job!.id }, data: { status: 'COMPLETED' } });
    const next = await createImportJob(prisma, { channelId: channel.id, type: 'IMPORT' }, runJobId);
    expect(next).toMatchObject({ type: 'IMPORT', origin: 'MANUAL', mode: 'ALL' });
  });
});
