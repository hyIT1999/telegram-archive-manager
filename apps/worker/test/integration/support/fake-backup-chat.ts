import { createHash } from 'node:crypto';
import type { MediaType } from '@tam/shared';
import {
  type BackupChatMessage,
  type BackupFileAttributes,
  type BackupPayload,
  ChatProtectedError,
  MediaUnavailableError,
  RandomIdDuplicateError,
  type SendBackupOptions,
  type SentBackupMessage,
  TelegramTimeoutError,
  TopicUnavailableError,
  type UploadedBackupFile,
  decodeFileId,
} from '@tam/telegram';
import { fakeContent } from './fake-files.js';
import { type createFakeTelegramApi, forumTopic } from './telegram-fixtures.js';

type FakeApi = ReturnType<typeof createFakeTelegramApi>['api'];

/** Bytes per chunk of a fake source stream. */
const CHUNK = 64 * 1024;

/** Where a scripted failure strikes. */
export type BackupStep = 'open' | 'upload' | 'send' | 'topic';

/** A file uploaded to the fake backup chat. */
export interface FakeUpload {
  id: string;
  kind: 'photo' | 'document';
  name: string | null;
  size: number;
  sha256: string;
  attributes: BackupFileAttributes;
}

const MEDIA_TYPES: Readonly<Record<BackupFileAttributes['kind'], MediaType>> = {
  photo: 'PHOTO',
  video: 'VIDEO',
  animation: 'ANIMATION',
  video_note: 'VIDEO_NOTE',
  audio: 'AUDIO',
  voice: 'VOICE',
  document: 'DOCUMENT',
};

function attributesOf(overrides: Partial<BackupFileAttributes>): BackupFileAttributes {
  return {
    kind: 'video',
    fileName: 'lesson.mp4',
    mimeType: 'video/mp4',
    width: 1280,
    height: 720,
    duration: 60,
    supportsStreaming: true,
    performer: null,
    title: null,
    ...overrides,
  };
}

function streamOf(content: Buffer, signal?: AbortSignal): ReadableStream<Uint8Array> {
  let position = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      signal?.throwIfAborted();
      if (position >= content.length) {
        controller.close();
        return;
      }
      const end = Math.min(content.length, position + CHUNK);
      controller.enqueue(new Uint8Array(content.subarray(position, end)));
      position = end;
    },
  });
}

/**
 * A Telegram backup chat for the fake adapter, with the contract of MtcuteTelegramAdapter: files
 * of archived messages stream from their sources, uploads are read to the end, sends create new
 * messages (a random id seen before is refused), forum topics are created on demand. Failures can
 * be scripted, and a send can "arrive" while its answer is lost.
 */
export class FakeBackupChat {
  /** The messages of the backup chat, oldest first. */
  readonly messages: BackupChatMessage[] = [];
  /** What the worker asked of Telegram, in order. */
  readonly calls: string[] = [];
  /** Every upload, in order. */
  readonly uploads: FakeUpload[] = [];
  /** Every payload sent, in order. */
  readonly payloads: BackupPayload[] = [];
  readonly topics: { id: number; title: string }[] = [];
  private readonly sources = new Map<
    string,
    { content: Buffer; attributes: BackupFileAttributes; protected: boolean }
  >();
  private readonly stored = new Map<string, FakeUpload>();
  private readonly failures = new Map<BackupStep, Error[]>();
  private readonly seenRandomIds = new Set<string>();
  private nextMessageId = 1_000;
  private nextFileId = 1;
  private nextTopicId = 500;
  private nextGroupId = 70_000;
  private loseReply = false;

  constructor(
    api: FakeApi,
    readonly chatId: string,
  ) {
    api.openBackupSource.mockImplementation((fileId, options) =>
      this.open(fileId, options?.signal),
    );
    api.uploadBackupFile.mockImplementation((_target, input, options) =>
      this.upload(input, options),
    );
    api.sendBackup.mockImplementation((_target, payload, options) => this.send(payload, options));
    api.createForumTopic.mockImplementation(async (_target, title) => this.createTopic(title));
    api.getForumTopics.mockImplementation(async (chatId) =>
      chatId === this.chatId
        ? this.topics.map((topic) =>
            forumTopic(topic.id, { title: topic.title, createdByMe: true }),
          )
        : [],
    );
    api.getBackupMessages.mockImplementation(async (_target, ids) => {
      this.calls.push('getBackupMessages');
      return this.messages.filter((message) => ids.includes(message.id));
    });
    api.getBackupHistory.mockImplementation(async (_target, after, limit = 100) => {
      this.calls.push('getBackupHistory');
      return this.messages.filter((message) => message.id > after).slice(0, limit);
    });
    api.readBackupFileHead.mockImplementation(async (_target, id, bytes) => {
      const message = this.messages.find((item) => item.id === id);
      if (!message?.media) {
        throw new MediaUnavailableError('MESSAGE_DELETED');
      }
      return Math.min(bytes, message.media.size ?? 0);
    });
    api.deleteBackupMessages.mockImplementation(async (_target, ids) => {
      this.calls.push('delete');
      for (const id of ids) {
        const at = this.messages.findIndex((message) => message.id === id);
        if (at >= 0) {
          this.messages.splice(at, 1);
        }
      }
    });
  }

  /** A file of an archived message, as Telegram serves it; returns its bytes. */
  addSource(
    fileUniqueId: string,
    size: number,
    attributes: Partial<BackupFileAttributes> = {},
  ): Buffer {
    const content = fakeContent(fileUniqueId, size);
    this.sources.set(fileUniqueId, {
      content,
      attributes: attributesOf(attributes),
      protected: false,
    });
    return content;
  }

  /** The archived message is gone from Telegram. */
  removeSource(fileUniqueId: string): void {
    this.sources.delete(fileUniqueId);
  }

  /** Content protection was turned on for the source chat. */
  protectSource(fileUniqueId: string): void {
    const source = this.sources.get(fileUniqueId);
    if (source) {
      source.protected = true;
    }
  }

  /** The next call at `step` fails with `error` (and nothing is posted). */
  failNext(step: BackupStep, error: Error): void {
    this.failures.set(step, [...(this.failures.get(step) ?? []), error]);
  }

  /** The next send reaches the backup chat, but its answer never reaches the worker. */
  loseNextSendReply(): void {
    this.loseReply = true;
  }

  /** Someone deleted a topic in the backup chat. */
  deleteTopic(id: number): void {
    const at = this.topics.findIndex((topic) => topic.id === id);
    if (at >= 0) {
      this.topics.splice(at, 1);
    }
  }

  private failure(step: BackupStep): Error | undefined {
    return this.failures.get(step)?.shift();
  }

  private async open(fileId: string, signal?: AbortSignal) {
    this.calls.push('open');
    const failure = this.failure('open');
    if (failure) {
      throw failure;
    }
    const { chatId, fileUniqueId } = decodeFileId(fileId);
    const source = this.sources.get(fileUniqueId);
    if (!source) {
      throw new MediaUnavailableError('MESSAGE_DELETED');
    }
    if (source.protected) {
      throw new ChatProtectedError(chatId);
    }
    return {
      stream: streamOf(source.content, signal),
      size: source.content.length,
      attributes: source.attributes,
    };
  }

  private async upload(
    input: { stream: ReadableStream<Uint8Array>; size: number; attributes: BackupFileAttributes },
    options?: { signal?: AbortSignal; onProgress?: (bytes: number) => void },
  ): Promise<UploadedBackupFile> {
    this.calls.push('upload');
    const failure = this.failure('upload');
    if (failure) {
      await input.stream.cancel().catch(() => undefined);
      throw failure;
    }
    const reader = input.stream.getReader();
    const hash = createHash('sha256');
    let size = 0;
    for (;;) {
      options?.signal?.throwIfAborted();
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      hash.update(value);
      size += value.length;
      options?.onProgress?.(size);
    }
    const upload: FakeUpload = {
      id: String(this.nextFileId++),
      kind: input.attributes.kind === 'photo' ? 'photo' : 'document',
      name: input.attributes.fileName,
      size,
      sha256: hash.digest('hex'),
      attributes: input.attributes,
    };
    this.stored.set(upload.id, upload);
    this.uploads.push(upload);
    return {
      kind: upload.kind,
      id: upload.id,
      accessHash: '7',
      fileReference: Buffer.from('ref').toString('base64'),
    };
  }

  private async send(
    payload: BackupPayload,
    options: SendBackupOptions,
  ): Promise<SentBackupMessage[]> {
    this.calls.push(
      payload.kind === 'text' ? 'sendText' : payload.items.length > 1 ? 'sendAlbum' : 'sendMedia',
    );
    const failure = this.failure('send');
    if (failure) {
      throw failure;
    }
    if (options.randomIds.some((id) => this.seenRandomIds.has(id.toString()))) {
      throw new RandomIdDuplicateError();
    }
    if (options.threadId !== null && !this.topics.some((topic) => topic.id === options.threadId)) {
      throw new TopicUnavailableError();
    }
    for (const id of options.randomIds) {
      this.seenRandomIds.add(id.toString());
    }
    this.payloads.push(payload);
    const common = {
      date: new Date(),
      isOutgoing: true,
      isForwarded: false,
      isService: false,
      threadId: options.threadId,
    };
    let created: BackupChatMessage[];
    if (payload.kind === 'text') {
      created = [
        {
          ...common,
          id: this.nextMessageId++,
          groupedId: null,
          text: payload.text.text,
          media: null,
        },
      ];
    } else {
      const groupedId = payload.items.length > 1 ? String(this.nextGroupId++) : null;
      created = payload.items.map((item) => {
        const file = this.stored.get(item.file.id);
        if (!file) {
          throw new Error(`Unknown uploaded file ${item.file.id}`);
        }
        return {
          ...common,
          id: this.nextMessageId++,
          groupedId,
          text: item.caption?.text ?? '',
          media: {
            type: MEDIA_TYPES[file.attributes.kind],
            fileName: file.kind === 'photo' ? null : file.name,
            size: file.size,
            fileUniqueId: `copy-${file.id}`,
            width: file.attributes.width,
            height: file.attributes.height,
          },
        };
      });
    }
    this.messages.push(...created);
    if (this.loseReply) {
      this.loseReply = false;
      throw new TelegramTimeoutError('The answer of Telegram was lost');
    }
    return created.map((message) => ({ messageId: message.id, groupedId: message.groupedId }));
  }

  private createTopic(title: string): number {
    this.calls.push('createTopic');
    const failure = this.failure('topic');
    if (failure) {
      throw failure;
    }
    const id = this.nextTopicId++;
    this.topics.push({ id, title });
    return id;
  }
}
