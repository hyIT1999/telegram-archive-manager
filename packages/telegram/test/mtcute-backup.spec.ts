import { createHash } from 'node:crypto';
import { Long, tl } from '@mtcute/core';
import { TelegramClient } from '@mtcute/core/client.js';
import { StubTelegramClient, createStub } from '@mtcute/test';
import { describe, expect, it } from 'vitest';
import {
  CaptionTooLongError,
  ChatProtectedError,
  ChatWriteForbiddenError,
  FloodWaitError,
  MediaUnavailableError,
  MtcuteTelegramAdapter,
  PeerFloodError,
  RandomIdDuplicateError,
  TopicUnavailableError,
  type UploadedBackupFile,
  UploadIncompleteError,
  toTlEntities,
} from '../src/index.js';

const SOURCE_ID = 1_234_567_890;
const SOURCE = String(-1_000_000_000_000 - SOURCE_ID);
const TARGET_ID = 777_000;
const TARGET = String(-1_000_000_000_000 - TARGET_ID);
const MIB = 1024 * 1024;

const sourceChat = createStub('channel', {
  id: SOURCE_ID,
  title: 'Lessons',
  megagroup: true,
  forum: true,
  accessHash: Long.fromNumber(1),
});
const targetChat = createStub('channel', {
  id: TARGET_ID,
  title: 'Backups',
  megagroup: true,
  forum: true,
  creator: true,
  accessHash: Long.fromNumber(2),
});

function rpcError(code: number, message: string): tl.RpcError {
  return tl.RpcError.fromTl({ errorCode: code, errorMessage: message });
}

/** Deterministic bytes, different for every file. */
function contentOf(size: number, seed: number): Uint8Array {
  const data = new Uint8Array(size);
  for (let index = 0; index < size; index += 1) {
    data[index] = (index * 31 + seed * 7) % 251;
  }
  return data;
}

function sha256(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

function videoDocument(id: number, size: number): tl.RawDocument {
  return createStub('document', {
    id: Long.fromNumber(id),
    accessHash: Long.fromNumber(id * 10),
    fileReference: new Uint8Array([1, 2, 3]),
    dcId: 2,
    size,
    mimeType: 'video/mp4',
    attributes: [
      { _: 'documentAttributeVideo', duration: 60, w: 1280, h: 720, supportsStreaming: true },
      { _: 'documentAttributeFilename', fileName: `lesson-${id}.mp4` },
    ],
  });
}

function sourceMessage(
  id: number,
  document: tl.RawDocument | null,
  extra: Partial<tl.RawMessage> = {},
) {
  return createStub('message', {
    id,
    peerId: { _: 'peerChannel', channelId: SOURCE_ID },
    date: 1_700_000_000 + id,
    message: 'lesson',
    ...(document ? { media: { _: 'messageMediaDocument', document } } : {}),
    ...extra,
  });
}

/** What the stub Telegram received from the backup calls. */
interface Received {
  /** Uploaded parts by upload file id, in part order. */
  parts: Map<string, Uint8Array[]>;
  uploadMedia: tl.messages.RawUploadMediaRequest[];
  sends: tl.TlObject[];
  getMessages: number;
}

function setup(
  messages: () => (tl.RawMessage | tl.RawMessageEmpty)[],
  files = new Map<string, Uint8Array>(),
) {
  const stub = new StubTelegramClient();
  const adapter = new MtcuteTelegramAdapter(new TelegramClient({ client: stub }));
  // A signed-in account without Premium (its upload limit is 2000 MiB).
  void stub.storage.self.store({ userId: 1, isBot: false, isPremium: false, usernames: [] });
  const received: Received = { parts: new Map(), uploadMedia: [], sends: [], getMessages: 0 };
  stub.respondWith('channels.getMessages', (request) => {
    received.getMessages += 1;
    const known = messages();
    const answer = (request.id as tl.RawInputMessageID[]).map(
      ({ id }) => known.find((item) => item.id === id) ?? createStub('messageEmpty', { id }),
    );
    return createStub('messages.channelMessages', {
      messages: answer,
      chats: [sourceChat, targetChat],
      users: [],
      count: answer.length,
    });
  });
  stub.respondWith('upload.getFile', (request) => {
    const location = request.location as tl.RawInputDocumentFileLocation;
    const data = files.get(location.id.toString()) ?? new Uint8Array();
    const start = Number(request.offset.toString());
    return createStub('upload.file', {
      type: { _: 'storage.filePartial' },
      mtime: 0,
      bytes: data.subarray(start, start + request.limit),
    });
  });
  const savePart = (fileId: tl.Long, part: number, bytes: Uint8Array) => {
    const list = received.parts.get(fileId.toString()) ?? [];
    list[part] = bytes;
    received.parts.set(fileId.toString(), list);
    return true;
  };
  stub.respondWith('upload.saveFilePart', (request) =>
    savePart(request.fileId, request.filePart, request.bytes),
  );
  stub.respondWith('upload.saveBigFilePart', (request) =>
    savePart(request.fileId, request.filePart, request.bytes),
  );
  stub.respondWith('messages.uploadMedia', (request) => {
    received.uploadMedia.push(request);
    const media = request.media as tl.RawInputMediaUploadedDocument;
    return {
      _: 'messageMediaDocument',
      document: createStub('document', {
        id: Long.fromNumber(9_000 + received.uploadMedia.length),
        accessHash: Long.fromNumber(42),
        fileReference: new Uint8Array([7, 7]),
        dcId: 2,
        size: 1,
        mimeType: media.mimeType,
        attributes: media.attributes,
      }),
    } satisfies tl.TypeMessageMedia;
  });
  return { stub, adapter, received };
}

/** The bytes that reached Telegram for one upload. */
function uploadedBytes(received: Received): Uint8Array {
  const [parts] = [...received.parts.values()];
  return Buffer.concat(parts ?? []);
}

function sentUpdates(
  sent: { id: number; randomId: tl.Long; groupedId?: tl.Long }[],
): tl.TypeUpdates {
  return createStub('updates', {
    updates: sent.flatMap(({ id, randomId, groupedId }) => [
      createStub('updateMessageID', { id, randomId }),
      createStub('updateNewChannelMessage', {
        message: createStub('message', {
          id,
          peerId: { _: 'peerChannel', channelId: TARGET_ID },
          date: 1_800_000_000,
          message: '',
          out: true,
          ...(groupedId ? { groupedId } : {}),
        }),
        pts: id,
        ptsCount: 1,
      }),
    ]),
    users: [],
    chats: [targetChat],
    date: 1_800_000_000,
    seq: 0,
  });
}

const storedFile = (id: string): UploadedBackupFile => ({
  kind: 'document',
  id,
  accessHash: '42',
  fileReference: Buffer.from([7, 7]).toString('base64'),
});

describe('MtcuteTelegramAdapter — backup sources and uploads', () => {
  it('streams a source file into a new upload, kept by Telegram with its attributes', async () => {
    const data = contentOf(300_000, 1);
    const document = videoDocument(10, data.length);
    const { stub, adapter, received } = setup(
      () => [sourceMessage(10, document)],
      new Map([['10', data]]),
    );
    await stub.registerPeers(sourceChat, targetChat);

    await stub.with(async () => {
      const [message] = await adapter.getMessages(SOURCE, ['10']);
      const source = await adapter.openBackupSource(message!.media[0]!.fileId);
      expect(source.size).toBe(data.length);
      expect(source.attributes).toEqual({
        kind: 'video',
        fileName: 'lesson-10.mp4',
        mimeType: 'video/mp4',
        width: 1280,
        height: 720,
        duration: 60,
        supportsStreaming: true,
        performer: null,
        title: null,
      });

      const progress: number[] = [];
      const uploaded = await adapter.uploadBackupFile(
        TARGET,
        { ...source, thumbnail: null },
        { onProgress: (bytes) => progress.push(bytes) },
      );

      expect(sha256(uploadedBytes(received))).toBe(sha256(data));
      expect(progress.at(-1)).toBe(data.length);
      expect(uploaded).toEqual({
        kind: 'document',
        id: '9001',
        accessHash: '42',
        fileReference: Buffer.from([7, 7]).toString('base64'),
      });
      const media = received.uploadMedia[0]!.media as tl.RawInputMediaUploadedDocument;
      expect(media._).toBe('inputMediaUploadedDocument');
      expect(media.attributes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            _: 'documentAttributeVideo',
            duration: 60,
            w: 1280,
            h: 720,
            supportsStreaming: true,
          }),
          expect.objectContaining({ _: 'documentAttributeFilename', fileName: 'lesson-10.mp4' }),
        ]),
      );
    });
  });

  it('reads the file again with a fresh reference when it expires midway, byte for byte', async () => {
    const data = contentOf(Math.round(2.5 * MIB), 2);
    const document = videoDocument(11, data.length);
    const { stub, adapter, received } = setup(
      () => [sourceMessage(11, document)],
      new Map([['11', data]]),
    );
    let failed = false;
    stub.respondWith('upload.getFile', (request) => {
      const start = Number(request.offset.toString());
      if (!failed && start >= MIB) {
        failed = true;
        throw rpcError(400, 'FILE_REFERENCE_EXPIRED');
      }
      return createStub('upload.file', {
        type: { _: 'storage.filePartial' },
        mtime: 0,
        bytes: data.subarray(start, start + request.limit),
      });
    });
    await stub.registerPeers(sourceChat, targetChat);

    await stub.with(async () => {
      const [message] = await adapter.getMessages(SOURCE, ['11']);
      const before = received.getMessages;
      const source = await adapter.openBackupSource(message!.media[0]!.fileId);
      await adapter.uploadBackupFile(TARGET, { ...source, thumbnail: null });
      expect(failed).toBe(true);
      // Read once to open, once more for the fresh reference.
      expect(received.getMessages - before).toBe(2);
      expect(sha256(uploadedBytes(received))).toBe(sha256(data));
    });
  });

  it('refuses a file whose message is gone or protected', async () => {
    const document = videoDocument(12, 100);
    let current: tl.RawMessage | tl.RawMessageEmpty = sourceMessage(12, document);
    const { stub, adapter } = setup(() => [current], new Map([['12', contentOf(100, 3)]]));
    await stub.registerPeers(sourceChat);

    await stub.with(async () => {
      const [message] = await adapter.getMessages(SOURCE, ['12']);
      const fileId = message!.media[0]!.fileId;
      current = sourceMessage(12, document, { noforwards: true });
      await expect(adapter.openBackupSource(fileId)).rejects.toBeInstanceOf(ChatProtectedError);
      current = createStub('messageEmpty', { id: 12 });
      await expect(adapter.openBackupSource(fileId)).rejects.toBeInstanceOf(MediaUnavailableError);
    });
  });
});

describe('MtcuteTelegramAdapter — sending backups', () => {
  it('sends an album as one group, silently, into the topic, each file with its caption', async () => {
    const { stub, adapter } = setup(() => []);
    await stub.registerPeers(targetChat);
    let request: tl.messages.RawSendMultiMediaRequest | undefined;
    stub.respondWith('messages.sendMultiMedia', (sent) => {
      request = sent;
      // Telegram numbers the album its own way: the answer is matched by random id.
      return sentUpdates(
        sent.multiMedia.map((item, index) => ({
          id: 502 - index,
          randomId: item.randomId,
          groupedId: Long.fromNumber(77),
        })),
      );
    });

    await stub.with(async () => {
      const result = await adapter.sendBackup(
        TARGET,
        {
          kind: 'media',
          items: [
            {
              file: storedFile('9001'),
              caption: { text: 'Bài 1', entities: [{ kind: 'bold', offset: 0, length: 3 }] },
            },
            { file: storedFile('9002'), caption: null },
          ],
        },
        { threadId: 42, randomIds: [11n, 12n] },
      );
      expect(result).toEqual([
        { messageId: 502, groupedId: '77' },
        { messageId: 501, groupedId: '77' },
      ]);
    });
    expect(request).toMatchObject({
      silent: true,
      replyTo: { _: 'inputReplyToMessage', replyToMsgId: 42, topMsgId: 42 },
    });
    expect(request!.multiMedia.map((item) => item.randomId.toString())).toEqual(['11', '12']);
    expect(request!.multiMedia[0]).toMatchObject({
      message: 'Bài 1',
      entities: [{ _: 'messageEntityBold', offset: 0, length: 3 }],
      media: { _: 'inputMediaDocument', id: { _: 'inputDocument' } },
    });
    expect(request!.multiMedia[1]).toMatchObject({ message: '' });
    expect(request!.multiMedia[1]!.entities).toBeUndefined();
  });

  it('sends a text with its formatting, without a link preview when asked', async () => {
    const { stub, adapter } = setup(() => []);
    await stub.registerPeers(targetChat);
    let request: tl.messages.RawSendMessageRequest | undefined;
    stub.respondWith('messages.sendMessage', (sent) => {
      request = sent;
      return sentUpdates([{ id: 600, randomId: sent.randomId }]);
    });

    await stub.with(async () => {
      await expect(
        adapter.sendBackup(
          TARGET,
          {
            kind: 'text',
            text: {
              text: 'Xem https://example.com',
              entities: [
                { kind: 'url', offset: 4, length: 19 },
                { kind: 'customEmoji', offset: 0, length: 2, params: { documentId: '5' } },
              ],
            },
            disableWebPreview: true,
          },
          { threadId: null, randomIds: [99n] },
        ),
      ).resolves.toEqual([{ messageId: 600, groupedId: null }]);
    });
    expect(request).toMatchObject({
      message: 'Xem https://example.com',
      noWebpage: true,
      silent: true,
      entities: [{ _: 'messageEntityUrl', offset: 4, length: 19 }],
    });
    expect(request!.randomId.toString()).toBe('99');
    expect(request!.replyTo).toBeUndefined();
  });

  it('turns what Telegram refuses into errors the worker acts on', async () => {
    const { stub, adapter } = setup(() => []);
    await stub.registerPeers(targetChat);
    const send = (error: string) => {
      stub.respondWith('messages.sendMedia', () => {
        throw rpcError(400, error);
      });
      return adapter.sendBackup(
        TARGET,
        { kind: 'media', items: [{ file: storedFile('9001'), caption: null }] },
        { threadId: null, randomIds: [1n] },
      );
    };
    const album = (error: string) => {
      stub.respondWith('messages.sendMultiMedia', () => {
        throw rpcError(400, error);
      });
      return adapter.sendBackup(
        TARGET,
        {
          kind: 'media',
          items: [
            { file: storedFile('9001'), caption: null },
            { file: storedFile('9002'), caption: null },
          ],
        },
        { threadId: null, randomIds: [1n, 2n] },
      );
    };

    await stub.with(async () => {
      await expect(send('RANDOM_ID_DUPLICATE')).rejects.toBeInstanceOf(RandomIdDuplicateError);
      await expect(send('CHAT_WRITE_FORBIDDEN')).rejects.toBeInstanceOf(ChatWriteForbiddenError);
      await expect(send('CHAT_SEND_MEDIA_FORBIDDEN')).rejects.toBeInstanceOf(
        ChatWriteForbiddenError,
      );
      await expect(send('MEDIA_CAPTION_TOO_LONG')).rejects.toBeInstanceOf(CaptionTooLongError);
      await expect(send('TOPIC_DELETED')).rejects.toBeInstanceOf(TopicUnavailableError);
      await expect(send('PEER_FLOOD')).rejects.toBeInstanceOf(PeerFloodError);
      await expect(send('FLOOD_WAIT_300')).rejects.toBeInstanceOf(FloodWaitError);
      const expired = await album('FILE_REFERENCE_1_EXPIRED').catch((error: unknown) => error);
      expect(expired).toBeInstanceOf(UploadIncompleteError);
      expect(expired).toMatchObject({ fileIndex: 1 });
    });
  });

  it('refuses a send whose random ids do not match its messages', async () => {
    const { stub, adapter } = setup(() => []);
    await stub.with(async () => {
      await expect(
        adapter.sendBackup(
          TARGET,
          { kind: 'text', text: { text: 'x', entities: [] }, disableWebPreview: false },
          { threadId: null, randomIds: [] },
        ),
      ).rejects.toThrow(/random id/);
    });
  });
});

describe('MtcuteTelegramAdapter — backup chats', () => {
  it('creates forum topics, reads and deletes backup messages', async () => {
    const { stub, adapter } = setup(() => []);
    await stub.registerPeers(targetChat);
    stub.respondWith('messages.createForumTopic', (request) =>
      createStub('updates', {
        updates: [
          createStub('updateNewChannelMessage', {
            message: createStub('messageService', {
              id: 55,
              peerId: { _: 'peerChannel', channelId: TARGET_ID },
              date: 1_800_000_000,
              action: { _: 'messageActionTopicCreate', title: request.title, iconColor: 0 },
            }),
            pts: 1,
            ptsCount: 1,
          }),
        ],
        users: [],
        chats: [targetChat],
        date: 1_800_000_000,
        seq: 0,
      }),
    );
    const history = [
      createStub('message', {
        id: 70,
        peerId: { _: 'peerChannel', channelId: TARGET_ID },
        date: 1_800_000_070,
        message: 'Bài 1',
        out: true,
        replyTo: { _: 'messageReplyHeader', forumTopic: true, replyToMsgId: 55 },
        media: { _: 'messageMediaDocument', document: videoDocument(9_001, 300) },
      }),
      createStub('message', {
        id: 71,
        peerId: { _: 'peerChannel', channelId: TARGET_ID },
        date: 1_800_000_071,
        message: 'forwarded',
        fwdFrom: { _: 'messageFwdHeader', date: 1_700_000_000 },
      }),
    ];
    stub.respondWith('messages.getHistory', () =>
      createStub('messages.channelMessages', {
        messages: [...history].reverse(),
        chats: [targetChat],
        users: [],
        count: history.length,
      }),
    );
    let deleted: tl.channels.RawDeleteMessagesRequest | undefined;
    stub.respondWith('channels.deleteMessages', (request) => {
      deleted = request;
      return createStub('messages.affectedMessages', { pts: 2, ptsCount: 1 });
    });

    await stub.with(async () => {
      await expect(adapter.createForumTopic(TARGET, 'Bài giảng')).resolves.toBe(55);
      const messages = await adapter.getBackupHistory(TARGET, 69);
      expect(messages.map((message) => message.id)).toEqual([70, 71]);
      expect(messages[0]).toMatchObject({
        isOutgoing: true,
        isForwarded: false,
        threadId: 55,
        text: 'Bài 1',
        media: { type: 'VIDEO', fileName: 'lesson-9001.mp4', size: 300 },
      });
      expect(messages[1]).toMatchObject({ isOutgoing: false, isForwarded: true, media: null });
      await adapter.deleteBackupMessages(TARGET, [70]);
      await adapter.deleteBackupMessages(TARGET, []);
    });
    expect(deleted?.id).toEqual([70]);
  });
});

describe('toTlEntities', () => {
  it('sends the stored formatting again and leaves out what needs references', () => {
    expect(
      toTlEntities([
        { kind: 'bold', offset: 0, length: 4 },
        { kind: 'textUrl', offset: 5, length: 3, params: { url: 'https://example.com' } },
        { kind: 'pre', offset: 9, length: 2 },
        { kind: 'blockquote', offset: 12, length: 1, params: { collapsed: true } },
        { kind: 'mentionName', offset: 0, length: 1, params: { userId: '1' } },
        { kind: 'customEmoji', offset: 0, length: 2, params: { documentId: '5' } },
        { kind: 'textUrl', offset: 0, length: 1 },
        { kind: 'somethingNew', offset: 0, length: 1 },
      ]),
    ).toEqual([
      { _: 'messageEntityBold', offset: 0, length: 4 },
      { _: 'messageEntityTextUrl', offset: 5, length: 3, url: 'https://example.com' },
      { _: 'messageEntityPre', offset: 9, length: 2, language: '' },
      { _: 'messageEntityBlockquote', offset: 12, length: 1, collapsed: true },
    ]);
  });
});
