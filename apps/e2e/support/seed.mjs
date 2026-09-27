// The small archive the browser tests read: two channels (one a forum with two topics), text
// messages, a stored image and PDF, a video not downloaded yet, a tag, a favorite and a running
// import. Neutral, made-up content only.
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { LocalFolderPolicy } from '@tam/storage';
import { pdfDocument, pngImage } from './files.mjs';

const FORUM_CHAT_ID = -1001000000001n;
const CHANNEL_CHAT_ID = -1001000000002n;

const postedOn = (day, hour = 9) => new Date(Date.UTC(2026, 0, day, hour));

export async function seedArchive(prisma, { storageDir, users, hashPassword }) {
  for (const user of users) {
    await prisma.user.create({
      data: { email: user.email, passwordHash: await hashPassword(user.password) },
    });
  }
  // The api would create the same built-in location at startup; it keeps this one.
  const location = await prisma.storageLocation.create({
    data: {
      kind: 'LOCAL',
      name: 'This computer',
      displayPath: storageDir,
      target: LocalFolderPolicy.identity(storageDir),
      config: { path: storageDir },
      builtIn: true,
      isDefault: true,
    },
  });

  const forum = await prisma.channel.create({
    data: {
      telegramChatId: FORUM_CHAT_ID,
      title: 'Physics Forum',
      type: 'SUPERGROUP',
      isForum: true,
      headMessageId: 23,
      backfillComplete: true,
      lastSyncedAt: new Date(),
      downloadMedia: false,
      topicsRefreshedAt: new Date(),
    },
  });
  const channel = await prisma.channel.create({
    data: {
      telegramChatId: CHANNEL_CHAT_ID,
      title: 'Chemistry Channel',
      type: 'CHANNEL',
      headMessageId: 10,
      backfillComplete: true,
      downloadMedia: false,
    },
  });
  await prisma.forumTopic.createMany({
    data: [
      { channelId: forum.id, topicId: 2, title: 'Mechanics' },
      { channelId: forum.id, topicId: 3, title: 'Optics' },
    ],
  });

  // Messages 1–20 of the forum: text, spread over General (no thread) and the two topics.
  await prisma.message.createMany({
    data: Array.from({ length: 20 }, (_, index) => {
      const id = index + 1;
      return {
        channelId: forum.id,
        telegramMessageId: id,
        type: 'TEXT',
        text: `Homework ${id}: exercises for week ${id}`,
        telegramDate: postedOn(id),
        threadId: id % 3 === 0 ? null : id % 2 === 0 ? 2 : 3,
        isFavorite: id === 5,
        favoritedAt: id === 5 ? new Date() : null,
      };
    }),
  });
  await prisma.message.createMany({
    data: Array.from({ length: 10 }, (_, index) => ({
      channelId: channel.id,
      telegramMessageId: index + 1,
      type: 'TEXT',
      text: `Reaction notes ${index + 1}`,
      telegramDate: postedOn(index + 1, 15),
    })),
  });

  const files = [
    {
      id: 21,
      thread: 3,
      type: 'PHOTO',
      name: 'Diagram 3.png',
      mime: 'image/png',
      bytes: pngImage(96, 64),
      width: 96,
      height: 64,
    },
    {
      id: 22,
      thread: 2,
      type: 'DOCUMENT',
      name: 'Chapter 2 notes.pdf',
      mime: 'application/pdf',
      bytes: pdfDocument('Chapter 2 notes'),
    },
    // Not downloaded: only its details are archived.
    {
      id: 23,
      thread: 2,
      type: 'VIDEO',
      name: 'Lesson 01 intro.mp4',
      mime: 'video/mp4',
      size: 48_000_000,
    },
  ];
  const ids = {};
  for (const file of files) {
    const message = await prisma.message.create({
      data: {
        channelId: forum.id,
        telegramMessageId: file.id,
        type: file.type,
        caption: file.type === 'PHOTO' ? 'Ray diagram for the lens exercise' : null,
        telegramDate: postedOn(file.id),
        threadId: file.thread,
      },
    });
    const stored = file.bytes !== undefined;
    const key = `Physics Forum (${FORUM_CHAT_ID})/2026-01/${file.id} - ${file.name}`;
    if (stored) {
      const target = path.join(storageDir, ...key.split('/'));
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, file.bytes);
    }
    const size = stored ? file.bytes.length : file.size;
    const media = await prisma.media.create({
      data: {
        messageId: message.id,
        telegramFileId: `${FORUM_CHAT_ID}:${file.id}:file-${file.id}`,
        telegramFileUniqueId: `file-${file.id}`,
        type: file.type,
        filename: file.name,
        mimeType: file.mime,
        size: BigInt(size),
        width: file.width ?? null,
        height: file.height ?? null,
        downloadStatus: stored ? 'DOWNLOADED' : 'PENDING',
        downloadProgress: stored ? 100 : 0,
        downloadedBytes: BigInt(stored ? size : 0),
        storageLocationId: stored ? location.id : null,
        storageKey: stored ? key : null,
        checksum: stored ? createHash('sha256').update(file.bytes).digest('hex') : null,
      },
    });
    await prisma.downloadJob.create({
      data: {
        mediaId: media.id,
        status: stored ? 'COMPLETED' : 'PENDING',
        progress: stored ? 100 : 0,
      },
    });
    ids[file.name] = message.id;
  }

  const exam = await prisma.tag.create({
    data: { name: 'Exam', nameNormalized: 'exam', color: '#b3261e' },
  });
  await prisma.messageTag.create({
    data: { messageId: ids['Chapter 2 notes.pdf'], tagId: exam.id },
  });

  // An import the live test moves forward by writing to the database, as the worker would.
  await prisma.importJob.create({
    data: {
      channelId: channel.id,
      status: 'RUNNING',
      phase: 'HISTORY',
      runSeq: 1,
      totalMessages: 200,
      processedMessages: 40,
      startedAt: new Date(),
    },
  });
}
