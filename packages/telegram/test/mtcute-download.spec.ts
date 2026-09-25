import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Long, tl } from '@mtcute/core';
import { TelegramClient } from '@mtcute/core/client.js';
import { StubTelegramClient, createStub } from '@mtcute/test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ChatProtectedError,
  DOWNLOAD_RESUME_ALIGNMENT,
  MediaUnavailableError,
  MtcuteTelegramAdapter,
  type MessageMedia,
  encodeFileId,
} from '../src/index.js';

const CHANNEL_ID = 1_234_567_890;
const MARKED_CHANNEL_ID = String(-1_000_000_000_000 - CHANNEL_ID);
const MIB = 1024 * 1024;

const channel = createStub('channel', {
  id: CHANNEL_ID,
  title: 'Lessons',
  username: 'lessons',
  broadcast: true,
  accessHash: Long.fromNumber(987_654),
});

function rpcError(code: number, message: string): tl.RpcError {
  return tl.RpcError.fromTl({ errorCode: code, errorMessage: message });
}

function documentStub(id: number, size: number, thumbs: tl.TypePhotoSize[] = []): tl.RawDocument {
  return createStub('document', {
    id: Long.fromNumber(id),
    accessHash: Long.fromNumber(id * 10),
    fileReference: new Uint8Array([1, 2, 3]),
    dcId: 2,
    size,
    mimeType: 'video/mp4',
    thumbs,
    attributes: [
      { _: 'documentAttributeVideo', duration: 60, w: 1280, h: 720 },
      { _: 'documentAttributeFilename', fileName: `lesson-${id}.mp4` },
    ],
  });
}

function messageWith(
  id: number,
  document: tl.RawDocument | null,
  extra: Partial<tl.RawMessage> = {},
): tl.RawMessage {
  return createStub('message', {
    id,
    peerId: { _: 'peerChannel', channelId: CHANNEL_ID },
    date: 1_700_000_000 + id,
    message: 'lesson',
    ...(document ? { media: { _: 'messageMediaDocument', document } } : {}),
    ...extra,
  });
}

interface FakeFile {
  /** Bytes served for a document id (or for a thumbnail, by "id:size"). */
  bytes: Map<string, Uint8Array>;
  getFileRequests: tl.upload.RawGetFileRequest[];
  getMessagesCalls: number;
}

/** A Telegram that knows a few messages and serves their files part by part. */
function setup(messages: () => (tl.RawMessage | tl.RawMessageEmpty)[]) {
  const stub = new StubTelegramClient();
  const adapter = new MtcuteTelegramAdapter(new TelegramClient({ client: stub }));
  const fake: FakeFile = { bytes: new Map(), getFileRequests: [], getMessagesCalls: 0 };
  stub.respondWith('channels.getMessages', (request) => {
    fake.getMessagesCalls += 1;
    const known = messages();
    // Like Telegram: one entry per requested id, messageEmpty for the ones that do not exist.
    const answer = (request.id as tl.RawInputMessageID[]).map(
      ({ id }) => known.find((message) => message.id === id) ?? createStub('messageEmpty', { id }),
    );
    return createStub('messages.channelMessages', {
      messages: answer,
      chats: [channel],
      users: [],
      count: answer.length,
    });
  });
  stub.respondWith('upload.getFile', (request) => {
    fake.getFileRequests.push(request);
    const location = request.location as tl.RawInputDocumentFileLocation;
    const key = location.thumbSize
      ? `${location.id.toString()}:${location.thumbSize}`
      : location.id.toString();
    const data = fake.bytes.get(key) ?? new Uint8Array();
    const start = Number(request.offset.toString());
    return createStub('upload.file', {
      type: { _: 'storage.filePartial' },
      mtime: 0,
      bytes: data.subarray(start, start + request.limit),
    });
  });
  return { stub, adapter, fake };
}

describe('MtcuteTelegramAdapter — downloads', () => {
  let base: string;

  beforeEach(async () => {
    base = await mkdtemp(path.join(tmpdir(), 'tam-download-'));
  });

  afterEach(async () => {
    await rm(base, { recursive: true, force: true });
  });

  async function mediaOf(adapter: MtcuteTelegramAdapter, messageId: string): Promise<MessageMedia> {
    const [message] = await adapter.getMessages(MARKED_CHANNEL_ID, [messageId]);
    return message!.media[0]!;
  }

  it('downloads a file part by part, with progress, after reading the message again', async () => {
    const content = randomBytes(2 * MIB + 12_345);
    const { stub, adapter, fake } = setup(() => [
      messageWith(5, documentStub(501, content.length)),
    ]);
    fake.bytes.set('501', content);
    await stub.registerPeers(channel);

    await stub.with(async () => {
      const media = await mediaOf(adapter, '5');
      const target = path.join(base, 'lesson.part');
      const progress: number[] = [];
      const file = await adapter.downloadFile(media.fileId, {
        destPath: target,
        onProgress: (downloaded, total) => {
          progress.push(downloaded);
          expect(total).toBe(content.length);
        },
      });

      expect(file).toEqual({
        path: target,
        size: content.length,
        mimeType: 'video/mp4',
        fileName: 'lesson-501.mp4',
      });
      expect((await readFile(target)).equals(content)).toBe(true);
      expect(progress.at(-1)).toBe(content.length);
      expect(fake.getFileRequests.length).toBeGreaterThan(2);
      // One getMessages for mediaOf, one more for a fresh file reference.
      expect(fake.getMessagesCalls).toBe(2);
    });
  });

  it('resumes at the last whole MiB of a partial file', async () => {
    const content = randomBytes(3 * MIB + 100);
    const { stub, adapter, fake } = setup(() => [
      messageWith(6, documentStub(601, content.length)),
    ]);
    fake.bytes.set('601', content);
    await stub.registerPeers(channel);

    await stub.with(async () => {
      const media = await mediaOf(adapter, '6');
      const target = path.join(base, 'resume.part');
      // 1.5 MiB kept from an earlier try, the last half MiB of it damaged.
      await writeFile(
        target,
        Buffer.concat([content.subarray(0, MIB), Buffer.alloc(MIB / 2, 0xff)]),
      );

      await adapter.downloadFile(media.fileId, { destPath: target, offset: 1.5 * MIB });

      expect((await readFile(target)).equals(content)).toBe(true);
      expect(
        Math.min(...fake.getFileRequests.map((request) => Number(request.offset.toString()))),
      ).toBe(DOWNLOAD_RESUME_ALIGNMENT);
    });
  });

  it('never trusts an offset beyond what the part file holds', async () => {
    const content = randomBytes(MIB + 10);
    const { stub, adapter, fake } = setup(() => [
      messageWith(7, documentStub(701, content.length)),
    ]);
    fake.bytes.set('701', content);
    await stub.registerPeers(channel);

    await stub.with(async () => {
      const media = await mediaOf(adapter, '7');
      const target = path.join(base, 'short.part');
      await adapter.downloadFile(media.fileId, { destPath: target, offset: 5 * MIB });
      expect((await readFile(target)).equals(content)).toBe(true);
    });
  });

  it('fetches a fresh file reference when the old one expires mid-download', async () => {
    const content = randomBytes(2 * MIB + 7);
    const { stub, adapter, fake } = setup(() => [
      messageWith(8, documentStub(801, content.length)),
    ]);
    fake.bytes.set('801', content);
    await stub.registerPeers(channel);
    let expired = false;
    stub.respondWith('upload.getFile', (request) => {
      fake.getFileRequests.push(request);
      const start = Number(request.offset.toString());
      if (!expired && start >= MIB) {
        expired = true;
        throw rpcError(400, 'FILE_REFERENCE_EXPIRED');
      }
      return createStub('upload.file', {
        type: { _: 'storage.filePartial' },
        mtime: 0,
        bytes: content.subarray(start, start + request.limit),
      });
    });

    await stub.with(async () => {
      const media = await mediaOf(adapter, '8');
      const target = path.join(base, 'expired.part');
      await adapter.downloadFile(media.fileId, { destPath: target });

      expect(expired).toBe(true);
      expect((await readFile(target)).equals(content)).toBe(true);
      expect(fake.getMessagesCalls).toBe(3);
    });
  });

  it('tells a deleted message and a replaced file apart', async () => {
    let current: tl.RawMessage | tl.RawMessageEmpty = messageWith(9, documentStub(901, 10));
    const { stub, adapter } = setup(() => [current]);
    await stub.registerPeers(channel);

    await stub.with(async () => {
      const media = await mediaOf(adapter, '9');
      const target = path.join(base, 'gone.part');

      current = messageWith(9, documentStub(902, 10));
      await expect(adapter.downloadFile(media.fileId, { destPath: target })).rejects.toMatchObject({
        reason: 'MEDIA_REPLACED',
      });

      current = createStub('messageEmpty', { id: 9 });
      const deleted = adapter.downloadFile(media.fileId, { destPath: target });
      await expect(deleted).rejects.toBeInstanceOf(MediaUnavailableError);
      await expect(deleted).rejects.toMatchObject({ reason: 'MESSAGE_DELETED' });
    });
  });

  it('refuses files of a message that became protected', async () => {
    let protectedNow = false;
    const { stub, adapter } = setup(() => [
      messageWith(10, documentStub(1001, 10), protectedNow ? { noforwards: true } : {}),
    ]);
    await stub.registerPeers(channel);

    await stub.with(async () => {
      const media = await mediaOf(adapter, '10');
      protectedNow = true;
      await expect(
        adapter.downloadFile(media.fileId, { destPath: path.join(base, 'protected.part') }),
      ).rejects.toBeInstanceOf(ChatProtectedError);
    });
  });

  it('stops when asked and keeps what it downloaded', async () => {
    const content = randomBytes(3 * MIB);
    const { stub, adapter, fake } = setup(() => [
      messageWith(11, documentStub(1101, content.length)),
    ]);
    fake.bytes.set('1101', content);
    await stub.registerPeers(channel);

    await stub.with(async () => {
      const media = await mediaOf(adapter, '11');
      const target = path.join(base, 'stopped.part');
      const controller = new AbortController();
      await expect(
        adapter.downloadFile(media.fileId, {
          destPath: target,
          signal: controller.signal,
          onProgress: (downloaded) => {
            if (downloaded >= MIB) {
              controller.abort();
            }
          },
        }),
      ).rejects.toThrow();
      const kept = await readFile(target);
      expect(kept.length).toBeGreaterThanOrEqual(MIB);
      expect(kept.equals(content.subarray(0, kept.length))).toBe(true);
    });
  });

  it('rejects file ids it cannot read', async () => {
    const { stub, adapter } = setup(() => []);
    await stub.with(async () => {
      await expect(
        adapter.downloadFile('nonsense', { destPath: path.join(base, 'x.part') }),
      ).rejects.toMatchObject({
        code: 'TELEGRAM_ERROR',
      });
    });
  });

  it('reads small previews of several files at once', async () => {
    const thumb: tl.TypePhotoSize = { _: 'photoSize', type: 'm', w: 320, h: 180, size: 2_000 };
    const withPreview = documentStub(1201, 5_000, [thumb]);
    const withoutPreview = documentStub(1301, 5_000);
    const { stub, adapter, fake } = setup(() => [
      messageWith(12, withPreview),
      messageWith(13, withoutPreview),
    ]);
    const preview = randomBytes(2_000);
    fake.bytes.set('1201:m', preview);
    await stub.registerPeers(channel);

    await stub.with(async () => {
      const first = await mediaOf(adapter, '12');
      const second = await mediaOf(adapter, '13');
      const thumbnails = await adapter.getThumbnails(MARKED_CHANNEL_ID, [
        { messageId: '12', fileUniqueId: first.fileUniqueId },
        { messageId: '13', fileUniqueId: second.fileUniqueId },
        { messageId: '14', fileUniqueId: 'gone' },
      ]);
      expect(Buffer.from(thumbnails.get(first.fileUniqueId) ?? []).equals(preview)).toBe(true);
      expect(thumbnails.get(second.fileUniqueId)).toBeNull();
      expect(thumbnails.get('gone')).toBeNull();
      expect(
        encodeFileId({
          chatId: MARKED_CHANNEL_ID,
          messageId: '12',
          fileUniqueId: first.fileUniqueId,
        }),
      ).toBe(first.fileId);
    });
  });

  it('gives up on a preview Telegram never delivers, and goes on with the others', async () => {
    const thumb: tl.TypePhotoSize = { _: 'photoSize', type: 'm', w: 320, h: 180, size: 2_000 };
    const stuck = documentStub(1401, 5_000, [thumb]);
    const fine = documentStub(1501, 5_000, [thumb]);
    const { stub, adapter } = setup(() => [messageWith(15, stuck), messageWith(16, fine)]);
    const preview = randomBytes(2_000);
    stub.respondWith('upload.getFile', (request) => {
      const location = request.location as tl.RawInputDocumentFileLocation;
      if (location.id.toString() === '1401') {
        // Telegram answering "-503 Timeout" forever looks like this to the caller.
        return new Promise<never>(() => undefined);
      }
      return createStub('upload.file', {
        type: { _: 'storage.filePartial' },
        mtime: 0,
        bytes: preview,
      });
    });
    await stub.registerPeers(channel);

    await stub.with(async () => {
      const first = await mediaOf(adapter, '15');
      const second = await mediaOf(adapter, '16');
      const started = Date.now();
      const thumbnails = await adapter.getThumbnails(
        MARKED_CHANNEL_ID,
        [
          { messageId: '15', fileUniqueId: first.fileUniqueId },
          { messageId: '16', fileUniqueId: second.fileUniqueId },
        ],
        { timeoutMs: 200 },
      );
      expect(Date.now() - started).toBeLessThan(5_000);
      expect(thumbnails.get(first.fileUniqueId)).toBeNull();
      expect(Buffer.from(thumbnails.get(second.fileUniqueId) ?? []).equals(preview)).toBe(true);
    });
  });
});
