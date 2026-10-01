import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Test, type TestingModule } from '@nestjs/testing';
import { type Channel, type StorageLocation, seedMessageBackups } from '@tam/database';
import type { PrismaService } from '@tam/database/nest';
import { encodeFileId, FloodWaitError } from '@tam/telegram';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { BackupReconciler } from '../../src/backups/backup-reconciler.js';
import { BackupScheduler } from '../../src/backups/backup-scheduler.js';
import {
  BACKUP_TUNING,
  type BackupTuning,
  defaultBackupTuning,
} from '../../src/backups/backup-settings.js';
import { BackupVerifier } from '../../src/backups/backup-verifier.js';
import { IMPORT_SETTINGS } from '../../src/imports/import-settings.js';
import { MEDIA_SETTINGS } from '../../src/media/media-settings.js';
import { SYNC_SCHEDULER_SETTINGS } from '../../src/sync/sync-settings.js';
import { ACCOUNT_KEY } from '../../src/telegram/telegram-auth.service.js';
import { TelegramCooldown } from '../../src/telegram/telegram-cooldown.js';
import { TELEGRAM_API_PROVIDER } from '../../src/telegram/telegram.tokens.js';
import { WorkerModule } from '../../src/worker.module.js';
import { FakeBackupChat } from './support/fake-backup-chat.js';
import { dateOf } from './support/fake-chats.js';
import { testMediaSettings } from './support/media-fixtures.js';
import { IDLE_SYNC_SETTINGS } from './support/sync-fixtures.js';
import {
  createFakeTelegramApi,
  resetTelegramTables,
  testPrisma,
} from './support/telegram-fixtures.js';

const SOURCE_CHAT = '-1001000000077';
const BACKUP_CHAT = '-1007770000077';

const silent = { log() {}, error() {}, warn() {}, debug() {}, verbose() {}, fatal() {} };
const sha256 = (data: Buffer) => createHash('sha256').update(data).digest('hex');

/** Fast tuning; nothing runs by itself: the tests call round(), reconcile() and verify(). */
function testTuning(overrides: Partial<BackupTuning> = {}): BackupTuning {
  return {
    ...defaultBackupTuning(),
    schedulerIntervalMs: 3_600_000,
    seedIntervalMs: 0,
    reconcileIntervalMs: 3_600_000,
    touchIntervalMs: 1_000,
    quietAfterMs: 50,
    stallTimeoutMs: 2_000,
    maxAttempts: 3,
    retryBaseMs: 10,
    retryMaxMs: 50,
    unavailableRetryMs: 50,
    progressIntervalMs: 0,
    minSendGapMs: 0,
    albumSettleMs: 0,
    settingsCacheMs: 0,
    verifySampleFiles: 2,
    ...overrides,
  };
}

describe('Telegram backups', () => {
  let prisma: PrismaService;
  let app: TestingModule | undefined;
  let fake: ReturnType<typeof createFakeTelegramApi>;
  let chat: FakeBackupChat;
  let scheduler: BackupScheduler;
  let base: string;

  beforeAll(() => {
    prisma = testPrisma();
  });
  beforeEach(async () => {
    await resetTelegramTables(prisma);
    await prisma.telegramAccount.create({ data: { accountKey: ACCOUNT_KEY, authState: 'READY' } });
    base = await mkdtemp(path.join(tmpdir(), 'tam-backups-'));
  });
  afterEach(async () => {
    await app?.close();
    app = undefined;
    await rm(base, { recursive: true, force: true });
  });
  afterAll(async () => {
    await resetTelegramTables(prisma);
    await prisma.$disconnect();
  });

  async function boot(tuning: Partial<BackupTuning> = {}): Promise<TestingModule> {
    fake = createFakeTelegramApi();
    chat = new FakeBackupChat(fake.api, BACKUP_CHAT);
    const moduleRef = await Test.createTestingModule({ imports: [WorkerModule] })
      .overrideProvider(TELEGRAM_API_PROVIDER)
      .useValue(fake.provider)
      .overrideProvider(IMPORT_SETTINGS)
      .useValue({ pageDelayMs: 0, unavailableRetryMs: 100, reconcileIntervalMs: 3_600_000 })
      .overrideProvider(MEDIA_SETTINGS)
      .useValue(testMediaSettings({ schedulerIntervalMs: 3_600_000 }))
      .overrideProvider(SYNC_SCHEDULER_SETTINGS)
      .useValue(IDLE_SYNC_SETTINGS)
      .overrideProvider(BACKUP_TUNING)
      .useValue(testTuning(tuning))
      .setLogger(silent)
      .compile();
    await moduleRef.init();
    app = moduleRef;
    scheduler = moduleRef.get(BackupScheduler);
    await scheduler.idle();
    return moduleRef;
  }

  async function backedUpChannel(
    options: { forum?: boolean; enabled?: boolean } = {},
  ): Promise<{ channel: Channel; location: StorageLocation }> {
    const location = await prisma.storageLocation.create({
      data: {
        kind: 'TELEGRAM',
        name: 'Backups',
        displayPath: 'Telegram › Backups',
        target: BACKUP_CHAT,
        config: {
          chatId: BACKUP_CHAT,
          title: 'Backups',
          type: 'SUPERGROUP',
          isForum: options.forum ?? false,
        },
      },
    });
    const channel = await prisma.channel.create({
      data: {
        telegramChatId: BigInt(SOURCE_CHAT),
        title: 'Lessons',
        type: 'SUPERGROUP',
        isForum: options.forum ?? false,
        headMessageId: 1_000,
        backupLocationId: location.id,
        backupEnabled: options.enabled ?? true,
      },
    });
    return { channel, location };
  }

  function textMessage(
    channel: Channel,
    id: number,
    text: string,
    extra: { threadId?: number; entities?: object[] } = {},
  ) {
    return prisma.message.create({
      data: {
        channelId: channel.id,
        telegramMessageId: id,
        type: 'TEXT',
        text,
        entities: extra.entities ?? [],
        threadId: extra.threadId ?? null,
        telegramDate: dateOf(id),
      },
    });
  }

  async function videoMessage(
    channel: Channel,
    id: number,
    size: number,
    extra: {
      album?: bigint;
      caption?: string;
      threadId?: number;
      downloaded?: StorageLocation;
    } = {},
  ) {
    const fileUniqueId = `file-${id}`;
    const message = await prisma.message.create({
      data: {
        channelId: channel.id,
        telegramMessageId: id,
        type: 'VIDEO',
        caption: extra.caption ?? null,
        mediaGroupId: extra.album ?? null,
        threadId: extra.threadId ?? null,
        telegramDate: dateOf(id),
      },
    });
    const content = chat.addSource(fileUniqueId, size, { fileName: `lesson-${id}.mp4` });
    const media = await prisma.media.create({
      data: {
        messageId: message.id,
        telegramFileId: encodeFileId({ chatId: SOURCE_CHAT, messageId: String(id), fileUniqueId }),
        telegramFileUniqueId: fileUniqueId,
        type: 'VIDEO',
        filename: `lesson-${id}.mp4`,
        mimeType: 'video/mp4',
        size: BigInt(size),
        thumbnailCheckedAt: new Date(),
        ...(extra.downloaded
          ? {
              downloadStatus: 'DOWNLOADED',
              storageLocationId: extra.downloaded.id,
              storageKey: `Lessons/2026-01/${id} - lesson-${id}.mp4`,
            }
          : {}),
      },
    });
    return { message, media, content };
  }

  const backupsOf = (channel: Channel) =>
    prisma.messageBackup.findMany({
      where: { channelId: channel.id },
      include: { message: { select: { telegramMessageId: true } } },
      orderBy: { message: { telegramMessageId: 'asc' } },
    });

  const sends = () => chat.calls.filter((call) => call.startsWith('send'));

  it('sends every message as a new one, in order, albums together, each file uploaded again', async () => {
    await boot();
    const { channel } = await backedUpChannel();
    await textMessage(channel, 1, 'Welcome to the course', {
      entities: [{ kind: 'bold', offset: 0, length: 7 }],
    });
    const first = await videoMessage(channel, 2, 300_000, { album: 9n, caption: 'Part 1' });
    const second = await videoMessage(channel, 3, 200_000, { album: 9n });
    const single = await videoMessage(channel, 4, 100_000, { caption: 'Homework' });
    await prisma.message.create({
      data: {
        channelId: channel.id,
        telegramMessageId: 5,
        type: 'SERVICE',
        telegramDate: dateOf(5),
      },
    });
    await textMessage(channel, 6, 'See you next week');

    expect(await scheduler.round()).toBe(4);

    expect(sends()).toEqual(['sendText', 'sendAlbum', 'sendMedia', 'sendText']);
    expect(chat.calls.filter((call) => call === 'upload')).toHaveLength(3);
    expect(chat.uploads.map((upload) => [upload.name, upload.size, upload.sha256])).toEqual([
      ['lesson-2.mp4', 300_000, sha256(first.content)],
      ['lesson-3.mp4', 200_000, sha256(second.content)],
      ['lesson-4.mp4', 100_000, sha256(single.content)],
    ]);
    expect(chat.payloads[0]).toMatchObject({
      kind: 'text',
      text: { text: 'Welcome to the course', entities: [{ kind: 'bold', offset: 0, length: 7 }] },
      disableWebPreview: true,
    });
    const [intro, album1, album2, homework, outro] = chat.messages;
    expect(album1!.groupedId).not.toBeNull();
    expect(album2!.groupedId).toBe(album1!.groupedId);
    expect(album1!.text).toBe('Part 1');
    expect(homework!.text).toBe('Homework');
    expect(outro!.text).toBe('See you next week');
    expect(chat.messages.every((message) => !message.isForwarded)).toBe(true);

    const rows = await backupsOf(channel);
    // The service message gets no backup.
    expect(rows.map((row) => row.message.telegramMessageId)).toEqual([1, 2, 3, 4, 6]);
    expect(rows.every((row) => row.status === 'COMPLETED')).toBe(true);
    expect(rows.map((row) => row.backupMessageId)).toEqual(
      [intro, album1, album2, homework, outro].map((message) => message!.id),
    );
    expect(rows[1]).toMatchObject({
      backupChatId: BigInt(BACKUP_CHAT),
      sentName: 'lesson-2.mp4',
      sentSize: 300_000n,
      sentSha256: sha256(first.content),
      uploadedMedia: null,
      backupGroupedId: BigInt(album1!.groupedId!),
    });

    // A second run sends nothing again.
    const calls = chat.calls.length;
    expect(await scheduler.round()).toBe(0);
    expect(chat.calls).toHaveLength(calls);
    expect(await prisma.messageBackup.count()).toBe(5);
  });

  it('recreates the forum topics once, keeps General, and makes a deleted topic again', async () => {
    await boot();
    const { channel } = await backedUpChannel({ forum: true });
    await prisma.forumTopic.createMany({
      data: [
        { channelId: channel.id, topicId: 10, title: 'Buổi 1' },
        { channelId: channel.id, topicId: 20, title: 'Buổi 2' },
      ],
    });
    await textMessage(channel, 1, 'Lesson 1 notes', { threadId: 10 });
    await textMessage(channel, 2, 'Lesson 2 notes', { threadId: 20 });
    await videoMessage(channel, 3, 50_000, { threadId: 10, caption: 'Lesson 1 video' });
    await textMessage(channel, 4, 'For everyone');

    await scheduler.round();
    expect(chat.topics.map((topic) => topic.title)).toEqual(['Buổi 1', 'Buổi 2']);
    const [lesson1, lesson2] = chat.topics;
    expect(chat.messages.map((message) => message.threadId)).toEqual([
      lesson1!.id,
      lesson2!.id,
      lesson1!.id,
      null,
    ]);
    expect(await prisma.backupTopic.count()).toBe(2);

    // Someone deleted the topic in the backup chat: the next message makes it again.
    chat.deleteTopic(lesson1!.id);
    await textMessage(channel, 5, 'More lesson 1 notes', { threadId: 10 });
    await scheduler.round();
    const again = chat.topics.find((topic) => topic.title === 'Buổi 1');
    expect(again!.id).not.toBe(lesson1!.id);
    expect(chat.messages.at(-1)).toMatchObject({
      text: 'More lesson 1 notes',
      threadId: again!.id,
    });
    expect(await prisma.backupTopic.count()).toBe(2);
  });

  it('waits when Telegram asks, without a try, pausing only this backup chat', async () => {
    const moduleRef = await boot();
    const { channel, location } = await backedUpChannel();
    await textMessage(channel, 1, 'Hello');
    chat.failNext('send', new FloodWaitError(120));

    await scheduler.round();
    const [row] = await backupsOf(channel);
    expect(row).toMatchObject({ status: 'PENDING', attempts: 0 });
    expect(row!.notBefore!.getTime()).toBeGreaterThan(Date.now() + 100_000);
    const paused = await prisma.storageLocation.findUniqueOrThrow({ where: { id: location.id } });
    expect(paused.unavailableUntil!.getTime()).toBeGreaterThan(Date.now() + 100_000);
    expect(paused.lastError).toContain('Telegram asked to wait');
    // Reading, downloads and syncs are not held up by a wait of the sends.
    expect(moduleRef.get(TelegramCooldown).remainingMs()).toBe(0);
  });

  it('fails after the last try, and a retry backs it up', async () => {
    await boot({ maxAttempts: 2 });
    const { channel } = await backedUpChannel();
    await videoMessage(channel, 1, 10_000);
    chat.failNext('upload', new Error('connection reset'));
    chat.failNext('upload', new Error('connection reset'));

    await scheduler.round();
    await vi.waitFor(
      async () => {
        await scheduler.round();
        const [row] = await backupsOf(channel);
        expect(row).toMatchObject({ status: 'FAILED', attempts: 2, error: 'connection reset' });
      },
      { timeout: 5_000, interval: 50 },
    );

    // "Retry failed" (as the api does it).
    await prisma.messageBackup.updateMany({
      where: { channelId: channel.id, status: 'FAILED' },
      data: { status: 'PENDING', attempts: 0, error: null, notBefore: null },
    });
    await scheduler.round();
    const [row] = await backupsOf(channel);
    expect(row).toMatchObject({ status: 'COMPLETED', error: null });
    expect(sends()).toEqual(['sendMedia']);
  });

  it('never posts twice when the answer of a send is lost', async () => {
    await boot();
    const { channel } = await backedUpChannel();
    await videoMessage(channel, 1, 20_000, { caption: 'Only once' });
    chat.loseNextSendReply();

    await scheduler.round();
    expect(chat.messages).toHaveLength(1);
    const [row] = await backupsOf(channel);
    expect(row).toMatchObject({ status: 'COMPLETED', backupMessageId: chat.messages[0]!.id });
    expect(chat.calls).toContain('getBackupHistory');
  });

  it('settles runs that died: reads the backup chat first, sends only what did not arrive', async () => {
    const moduleRef = await boot();
    const { channel, location } = await backedUpChannel();
    await videoMessage(channel, 1, 20_000);
    await videoMessage(channel, 2, 20_000);
    await seedMessageBackups(prisma, { channelIds: [channel.id], storageLocationId: location.id });
    const [arrived, lost] = await backupsOf(channel);

    // Both were being sent when their worker died, long ago…
    const dying = {
      status: 'ACTIVE' as const,
      stage: 'SENDING' as const,
      owner: 'dead-worker',
      sentSize: 20_000n,
      updatedAt: new Date(Date.now() - 60_000),
    };
    await prisma.messageBackup.update({
      where: { id: arrived!.id },
      data: { ...dying, randomId: 41n, sentName: 'lesson-1.mp4' },
    });
    await prisma.messageBackup.update({
      where: { id: lost!.id },
      data: { ...dying, randomId: 42n, sentName: 'lesson-2.mp4' },
    });
    // …and only the first reached the backup chat.
    chat.messages.push({
      id: 1_500,
      date: new Date(),
      isOutgoing: true,
      isForwarded: false,
      isService: false,
      groupedId: null,
      threadId: null,
      text: '',
      media: {
        type: 'VIDEO',
        fileName: 'lesson-1.mp4',
        size: 20_000,
        fileUniqueId: 'copy-earlier',
        width: 1280,
        height: 720,
      },
    });

    expect(await moduleRef.get(BackupReconciler).reconcile()).toBe(2);
    const settled = await backupsOf(channel);
    expect(settled[0]).toMatchObject({ status: 'COMPLETED', backupMessageId: 1_500 });
    expect(settled[1]).toMatchObject({ status: 'PENDING', stage: null, randomId: 42n });
    expect(sends()).toEqual([]);

    // The one that did not arrive goes again, with the same random id.
    await scheduler.round();
    expect(chat.messages).toHaveLength(2);
    expect(await backupsOf(channel)).toEqual([
      expect.objectContaining({ status: 'COMPLETED', backupMessageId: 1_500 }),
      expect.objectContaining({ status: 'COMPLETED', randomId: 42n }),
    ]);
  });

  it('uses the downloaded copy when the message is gone from Telegram, and skips it otherwise', async () => {
    await boot();
    const { channel } = await backedUpChannel();
    const root = path.join(base, 'archive');
    const folder = await prisma.storageLocation.create({
      data: {
        kind: 'LOCAL',
        name: 'Folder',
        displayPath: root,
        target: root.toLowerCase(),
        config: { path: root },
      },
    });
    const kept = await videoMessage(channel, 1, 40_000, { downloaded: folder });
    const file = path.join(root, 'Lessons', '2026-01', '1 - lesson-1.mp4');
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, kept.content);
    chat.removeSource('file-1');
    await videoMessage(channel, 2, 40_000);
    chat.removeSource('file-2');

    await scheduler.round();
    const rows = await backupsOf(channel);
    expect(rows[0]).toMatchObject({ status: 'COMPLETED', sentSha256: sha256(kept.content) });
    expect(rows[1]).toMatchObject({ status: 'SKIPPED', skipReason: 'NOT_AVAILABLE' });
    expect(chat.uploads).toHaveLength(1);
    // Telegram was asked for the second file only: the first came from the folder.
    expect(chat.calls.filter((call) => call === 'open')).toHaveLength(1);
  });

  it('stops backing up a chat that turned on content protection', async () => {
    await boot();
    const { channel } = await backedUpChannel();
    await videoMessage(channel, 1, 10_000);
    await textMessage(channel, 2, 'After');
    chat.protectSource('file-1');

    await scheduler.round();
    const rows = await backupsOf(channel);
    expect(rows.map((row) => [row.status, row.skipReason])).toEqual([
      ['SKIPPED', 'PROTECTED'],
      ['SKIPPED', 'PROTECTED'],
    ]);
    expect(await prisma.channel.findUniqueOrThrow({ where: { id: channel.id } })).toMatchObject({
      backupEnabled: false,
      backupNote: expect.stringContaining('Content protection'),
    });
    expect(sends()).toEqual([]);
  });

  it('replaces the earlier copy when asked to back up again', async () => {
    await boot();
    const { channel } = await backedUpChannel();
    await videoMessage(channel, 1, 10_000);
    await scheduler.round();
    const [done] = await backupsOf(channel);
    const earlier = done!.backupMessageId!;

    // "Back up again" (as the api does it).
    await prisma.messageBackup.update({
      where: { id: done!.id },
      data: {
        status: 'PENDING',
        force: true,
        replacePrevious: true,
        replacedMessageIds: [earlier],
        requestedAt: new Date(),
        backupMessageId: null,
        randomId: null,
      },
    });
    await scheduler.round();
    const [again] = await backupsOf(channel);
    expect(again).toMatchObject({ status: 'COMPLETED', force: false, replacedMessageIds: [] });
    expect(again!.backupMessageId).not.toBe(earlier);
    expect(chat.messages.map((message) => message.id)).toEqual([again!.backupMessageId]);
    expect(chat.calls).toContain('delete');
  });

  it('verifies the copies: present, new, the file and text that were sent', async () => {
    const moduleRef = await boot();
    const { channel } = await backedUpChannel();
    await videoMessage(channel, 1, 10_000, { caption: 'One' });
    await textMessage(channel, 2, 'Two');
    await textMessage(channel, 3, 'Three');
    await scheduler.round();
    // Someone deleted a copy, and another was edited in the backup chat.
    const [, two, three] = chat.messages;
    chat.messages.splice(chat.messages.indexOf(two!), 1);
    three!.text = 'Changed';

    await moduleRef.get(BackupVerifier).verify(channel.id);
    const rows = await backupsOf(channel);
    expect(rows.every((row) => row.verifiedAt !== null)).toBe(true);
    expect(rows.map((row) => row.verifyError)).toEqual([
      null,
      'The copy is no longer in the backup chat.',
      'The text of the copy differs from the archived one.',
    ]);
  });

  it('backs up only what is asked for while automatic backup is off', async () => {
    await boot();
    const { channel, location } = await backedUpChannel({ enabled: false });
    await textMessage(channel, 1, 'First version');
    await prisma.message.create({
      data: {
        channelId: channel.id,
        telegramMessageId: 2,
        type: 'POLL',
        text: 'Which day?',
        telegramDate: dateOf(2),
      },
    });
    await seedMessageBackups(prisma, { channelIds: [channel.id], storageLocationId: location.id });
    // Automatic backup is off: only what is asked for runs.
    expect(await scheduler.round()).toBe(0);
    await prisma.messageBackup.updateMany({
      where: { channelId: channel.id },
      data: { requestedAt: new Date() },
    });
    await scheduler.round();
    expect(chat.messages.map((message) => message.text)).toEqual(['First version']);
    const rows = await backupsOf(channel);
    expect(rows.map((row) => row.status)).toEqual(['COMPLETED', 'SKIPPED']);
  });
});
