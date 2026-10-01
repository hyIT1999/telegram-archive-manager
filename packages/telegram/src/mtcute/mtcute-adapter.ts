import { constants as fsConstants } from 'node:fs';
import { open } from 'node:fs/promises';
import {
  type DeleteMessageUpdate,
  InputMedia,
  type InputMediaLike,
  Long,
  type Chat as MtChat,
  type Message as MtMessage,
  type Photo as MtPhoto,
  type RawDocument as MtRawDocument,
  Photo,
  type SentCode,
  Thumbnail,
  type UploadedFile,
  User as MtUser,
  getMarkedPeerId,
  tl,
} from '@mtcute/core';
import type { TelegramClient as MtTelegramClient } from '@mtcute/core/client.js';
import { TelegramAuthState, TelegramErrorCode } from '@tam/shared';
import {
  AuthRequiredError,
  ChatProtectedError,
  ChatUnavailableError,
  FileReferenceExpiredError,
  FloodWaitError,
  LoginStepError,
  MediaUnavailableError,
  TelegramError,
  UploadIncompleteError,
} from '../errors.js';
import { type FileIdParts, decodeFileId } from '../file-id.js';
import type { SendCodeResult, SignInResult, TelegramLoginApi } from '../login-api.js';
import type {
  TelegramBackupWriter,
  TelegramClient,
  TelegramHistoryReader,
  TelegramMediaReader,
} from '../telegram-client.js';
import type {
  AuthState,
  BackupChatMessage,
  BackupFileInput,
  BackupPayload,
  BackupSourceFile,
  Chat,
  DownloadOptions,
  DownloadedFile,
  ForumTopic,
  HistoryPage,
  HistoryPageOptions,
  LegacyGroup,
  Message,
  MessageEntity,
  SendBackupOptions,
  SentBackupMessage,
  TelegramUser,
  ThumbnailOptions,
  ThumbnailRequest,
  UpdateEvent,
  UpdateHandler,
  UploadedBackupFile,
} from '../types.js';
import { toTelegramError, translateErrors } from './error-mapping.js';
import {
  backupAttributesOf,
  mapBackupChatMessage,
  mapChat,
  mapForumTopic,
  mapMessage,
  mapUser,
  sizeOf,
  toTlEntities,
} from './mappers.js';

/** messages.getHistory never returns more than this per call. */
export const MAX_HISTORY_PAGE = 100;

/**
 * Resumed downloads restart at a multiple of 1 MiB: every part size mtcute uses divides it, and
 * Telegram refuses parts that cross a 1 MiB boundary. At most 1 MiB is fetched twice.
 */
export const DOWNLOAD_RESUME_ALIGNMENT = 1024 * 1024;

/** Without data for this long a download gives up (mtcute would otherwise wait forever). */
export const DEFAULT_STALL_TIMEOUT_MS = 120_000;

/** One thumbnail (at most 128 KB) that takes longer than this is given up on. */
export const DEFAULT_THUMBNAIL_TIMEOUT_MS = 30_000;

/** Fresh file references fetched for one download before giving up. */
const MAX_REFERENCE_REFRESHES = 3;

/** messages.getForumTopics returns at most this many topics per call. */
const FORUM_TOPICS_PAGE = 100;

/** Paging stops after this many pages (10,000 topics), whatever Telegram answers. */
const MAX_FORUM_TOPIC_PAGES = 100;

/** Written data is flushed to disk every so often, so a power cut loses little. */
const SYNC_EVERY_BYTES = 32 * 1024 * 1024;

/**
 * Bytes read ahead of a backup upload while its file streams from Telegram: downloading pauses
 * when this much waits in memory, so a large file never piles up in RAM.
 */
export const BACKUP_STREAM_BUFFER = 16 * 1024 * 1024;

type MtFile = MtPhoto | MtRawDocument;

/** Message media that is a downloadable file of the kinds the archive stores. */
const FILE_MEDIA_TYPES = new Set(['photo', 'video', 'document', 'audio', 'voice', 'sticker']);

function fileOf(message: MtMessage): MtFile | null {
  const media = message.media;
  return media && FILE_MEDIA_TYPES.has(media.type) ? (media as MtFile) : null;
}

function alignDown(offset: number): number {
  return Math.max(0, Math.floor(offset / DOWNLOAD_RESUME_ALIGNMENT) * DOWNLOAD_RESUME_ALIGNMENT);
}

/**
 * The real Telegram adapter, on top of mtcute. It is stateless: the pending-login state lives in
 * the worker's database, and mtcute's session storage holds the (encrypted) auth key.
 */
export class MtcuteTelegramAdapter
  implements
    TelegramLoginApi,
    TelegramHistoryReader,
    TelegramMediaReader,
    TelegramBackupWriter,
    TelegramClient
{
  /** Whether update handlers are registered on this client (once per client). */
  private listening = false;

  constructor(private readonly tg: MtTelegramClient) {}

  /**
   * Delivers the ids of new, edited and deleted messages of every chat to `handler`, and starts
   * receiving updates (the account must be logged in). A handler that throws never stops the
   * update loop.
   */
  async subscribeUpdates(handler?: UpdateHandler): Promise<void> {
    if (handler) {
      this.onUpdate(handler);
    }
    await this.startUpdates();
  }

  /**
   * Registers `handler` without receiving anything yet: a sign-in, or startUpdates(), starts the
   * update loop. Only the first handler of a client is kept.
   */
  onUpdate(handler: UpdateHandler): void {
    if (this.listening) {
      return;
    }
    this.listening = true;
    const deliver = (event: UpdateEvent) => {
      try {
        void Promise.resolve(handler(event)).catch(() => undefined);
      } catch {
        // The handler's own problem: the next update still arrives.
      }
    };
    this.tg.onNewMessage.add((message) => deliver({ kind: 'new_message', ...messageRef(message) }));
    this.tg.onEditMessage.add((message) =>
      deliver({ kind: 'edit_message', ...messageRef(message) }),
    );
    this.tg.onDeleteMessage.add((update) => deliver(deletedMessages(update)));
  }

  /** Starts (or keeps) receiving updates; idempotent. Needs a logged-in account. */
  async startUpdates(): Promise<void> {
    await translateErrors(() => this.tg.startUpdatesLoop());
  }

  async authenticate(): Promise<AuthState> {
    const user = await this.getAuthorizedUser();
    return {
      state: user ? TelegramAuthState.READY : TelegramAuthState.LOGGED_OUT,
      user,
      phoneMasked: null,
      codeType: null,
      nextCodeType: null,
      codeExpiresAt: null,
    };
  }

  async getAuthorizedUser(): Promise<TelegramUser | null> {
    try {
      return mapUser(await this.tg.getMe());
    } catch (error) {
      const translated = toTelegramError(error);
      if (translated instanceof AuthRequiredError) {
        return null;
      }
      throw translated;
    }
  }

  async sendCode(phoneNumber: string): Promise<SendCodeResult> {
    const result = await translateErrors(() => this.tg.sendCode({ phone: phoneNumber }));
    return result instanceof MtUser
      ? { kind: 'authorized', user: mapUser(result) }
      : fromSentCode(result);
  }

  async resendCode(phoneNumber: string, phoneCodeHash: string): Promise<SendCodeResult> {
    return fromSentCode(
      await translateErrors(() => this.tg.resendCode({ phone: phoneNumber, phoneCodeHash })),
    );
  }

  async signIn(phoneNumber: string, phoneCodeHash: string, code: string): Promise<SignInResult> {
    try {
      const user = await this.tg.signIn({ phone: phoneNumber, phoneCodeHash, phoneCode: code });
      return { kind: 'authorized', user: mapUser(user) };
    } catch (error) {
      if (tl.RpcError.is(error, 'SESSION_PASSWORD_NEEDED')) {
        return { kind: 'password_required' };
      }
      throw toTelegramError(error);
    }
  }

  async checkPassword(password: string): Promise<TelegramUser> {
    return mapUser(await translateErrors(() => this.tg.checkPassword(password)));
  }

  async logOut(): Promise<void> {
    await translateErrors(() => this.tg.logOut());
  }

  /** Channels, supergroups and basic groups in the account's dialogs (archived folder included). */
  async getChats(): Promise<Chat[]> {
    return translateErrors(async () => {
      const chats: Chat[] = [];
      for await (const dialog of this.tg.iterDialogs({ archived: 'keep' })) {
        const peer = dialog.peer;
        if (peer.type !== 'chat') {
          continue;
        }
        const chat = mapChat(peer);
        if (chat) {
          chats.push(chat);
        }
      }
      return chats;
    });
  }

  /** Reads the full chat, which also names the basic group a supergroup was upgraded from. */
  async refreshChat(chatId: string): Promise<Chat> {
    const full = await translateErrors(() => this.tg.getFullChat(toPeerId(chatId)));
    const chat = mapChat(full);
    if (!chat) {
      throw new ChatUnavailableError(
        `Chat ${chatId} is no longer a channel or group this account can read`,
      );
    }
    const migratedFrom = full.migratedFrom;
    return { ...chat, migratedFromChatId: migratedFrom ? String(-migratedFrom.chatId) : null };
  }

  async getLegacyGroup(chatId: string): Promise<LegacyGroup | null> {
    let chat: MtChat;
    try {
      chat = await this.tg.getChat(toPeerId(chatId));
    } catch (error) {
      const translated = toTelegramError(error);
      // Waits and a lost session concern every request; anything else means "not readable".
      if (translated instanceof FloodWaitError || translated instanceof AuthRequiredError) {
        throw translated;
      }
      return null;
    }
    // chatForbidden: the account was never in the old group, so its history is not readable.
    if (chat.raw._ !== 'chat') {
      return null;
    }
    return { id: String(chat.id), title: chat.title, isProtected: chat.hasContentProtection };
  }

  /**
   * Every topic of a forum, page by page. The raw call replaces mtcute's iterForumTopics, whose
   * paging reads each topic's last message and fails when Telegram leaves one out.
   */
  async getForumTopics(chatId: string): Promise<ForumTopic[]> {
    const peer = await translateErrors(() => this.tg.resolvePeer(toPeerId(chatId)));
    const topics = new Map<number, ForumTopic>();
    let offset = { offsetDate: 0, offsetId: 0, offsetTopic: 0 };
    for (let page = 0; page < MAX_FORUM_TOPIC_PAGES; page += 1) {
      const current = offset;
      const result = await translateErrors(() =>
        this.tg.call({
          _: 'messages.getForumTopics',
          peer,
          offsetDate: current.offsetDate,
          offsetId: current.offsetId,
          offsetTopic: current.offsetTopic,
          limit: FORUM_TOPICS_PAGE,
        }),
      );
      const found = result.topics.filter(
        (topic): topic is tl.RawForumTopic => topic._ === 'forumTopic',
      );
      for (const topic of found) {
        topics.set(topic.id, mapForumTopic(topic));
      }
      const last = found.at(-1);
      if (!last || found.length < FORUM_TOPICS_PAGE || topics.size >= result.count) {
        break;
      }
      // Topics come by creation date or by their last message; the next page starts after `last`.
      offset = {
        offsetDate: result.orderByCreateDate
          ? last.date
          : (messageDate(result.messages, last.topMessage) ?? last.date),
        offsetId: last.topMessage,
        offsetTopic: last.id,
      };
    }
    return [...topics.values()];
  }

  /** Newest → oldest, strictly older than `fromMessageId`; empty when history is exhausted. */
  async getChatHistory(
    chatId: string,
    fromMessageId?: string,
    limit = MAX_HISTORY_PAGE,
  ): Promise<Message[]> {
    const page = await this.getHistoryPage(chatId, {
      ...(fromMessageId === undefined ? {} : { beforeMessageId: fromMessageId }),
      limit,
    });
    return page.messages;
  }

  async getHistoryPage(chatId: string, options: HistoryPageOptions = {}): Promise<HistoryPage> {
    const before =
      options.beforeMessageId === undefined ? undefined : toMessageId(options.beforeMessageId);
    const offset =
      before !== undefined
        ? { id: before, date: 0 }
        : options.beforeDate
          ? { id: 0, date: Math.floor(options.beforeDate.getTime() / 1000) }
          : undefined;
    const messages = await translateErrors(() =>
      this.tg.getHistory(toPeerId(chatId), {
        limit: clampLimit(options.limit ?? MAX_HISTORY_PAGE),
        ...(offset ? { offset } : {}),
      }),
    );
    return {
      messages: messages
        .filter((message) => before === undefined || message.id < before)
        .map((message) => mapMessage(message, chatId))
        .sort((a, b) => Number(b.id) - Number(a.id)),
      total: messages.total,
    };
  }

  /** Oldest → newest, strictly newer than `afterMessageId`. */
  async getNewerMessages(
    chatId: string,
    afterMessageId: string,
    limit = MAX_HISTORY_PAGE,
  ): Promise<Message[]> {
    const after = toMessageId(afterMessageId);
    const messages = await translateErrors(() =>
      this.tg.getHistory(toPeerId(chatId), {
        limit: clampLimit(limit),
        reverse: true,
        offset: { id: after + 1, date: 0 },
      }),
    );
    return messages
      .filter((message) => message.id > after)
      .map((message) => mapMessage(message, chatId))
      .sort((a, b) => Number(a.id) - Number(b.id));
  }

  async getMessages(chatId: string, messageIds: string[]): Promise<Message[]> {
    if (messageIds.length === 0) {
      return [];
    }
    const messages = await translateErrors(() =>
      this.tg.getMessages(toPeerId(chatId), messageIds.map(toMessageId)),
    );
    return messages.flatMap((message) => (message ? [mapMessage(message, chatId)] : []));
  }

  async downloadFile(fileId: string, options: DownloadOptions = {}): Promise<DownloadedFile> {
    const { destPath, signal, onProgress } = options;
    if (!destPath) {
      throw new TelegramError('A download needs a target file', TelegramErrorCode.TELEGRAM_ERROR);
    }
    const parts = toFileIdParts(fileId);
    signal?.throwIfAborted();
    // Read/write without truncating: the part already downloaded is kept (not append mode, which
    // ignores write positions on Linux).
    const handle = await open(destPath, fsConstants.O_RDWR | fsConstants.O_CREAT);
    try {
      // Whatever lies past the resume point is fetched again (it may be a half-written part).
      const { size: stored } = await handle.stat();
      let position = alignDown(Math.min(options.offset ?? 0, stored));
      await handle.truncate(position);
      let synced = position;
      for (let refreshes = 0; ; refreshes += 1) {
        const file = await this.currentFile(parts);
        const total = sizeOf(file.fileSize);
        // mtcute leaves requests in flight when the loop ends early: this stops them too.
        const stop = new AbortController();
        const forward = () => stop.abort(signal?.reason);
        signal?.addEventListener('abort', forward, { once: true });
        try {
          for await (const chunk of this.tg.downloadAsIterable(file, {
            offset: position,
            abortSignal: stop.signal,
            stallTimeout: options.stallTimeoutMs ?? DEFAULT_STALL_TIMEOUT_MS,
            ...(total === null ? {} : { fileSize: total }),
          })) {
            await handle.write(chunk, 0, chunk.length, position);
            position += chunk.length;
            if (position - synced >= SYNC_EVERY_BYTES) {
              await handle.sync();
              synced = position;
            }
            onProgress?.(position, total);
            signal?.throwIfAborted();
          }
          await handle.sync();
          if (total !== null && position !== total) {
            throw new TelegramError(
              `Telegram sent ${position} of ${total} bytes`,
              TelegramErrorCode.TELEGRAM_ERROR,
            );
          }
          return {
            path: destPath,
            size: position,
            mimeType: mimeTypeOf(file),
            fileName: fileNameOf(file),
          };
        } catch (error) {
          signal?.throwIfAborted();
          const translated = toTelegramError(error);
          if (
            !(translated instanceof FileReferenceExpiredError) ||
            refreshes >= MAX_REFERENCE_REFRESHES
          ) {
            throw translated;
          }
          // Read the message again for a fresh reference and go on from the last whole MiB.
          position = alignDown(position);
          await handle.truncate(position);
          synced = Math.min(synced, position);
        } finally {
          stop.abort();
          signal?.removeEventListener('abort', forward);
        }
      }
    } finally {
      await handle.close();
    }
  }

  async getThumbnails(
    chatId: string,
    files: readonly ThumbnailRequest[],
    options: ThumbnailOptions = {},
  ): Promise<Map<string, Uint8Array | null>> {
    const thumbnails = new Map<string, Uint8Array | null>();
    if (files.length === 0) {
      return thumbnails;
    }
    const ids = [...new Set(files.map((file) => toMessageId(file.messageId)))].slice(
      0,
      MAX_HISTORY_PAGE,
    );
    const messages = await translateErrors(() => this.tg.getMessages(toPeerId(chatId), ids));
    const byId = new Map(
      messages.flatMap((message) => (message ? [[message.id, message] as const] : [])),
    );
    for (const request of files) {
      options.signal?.throwIfAborted();
      const message = byId.get(Number(request.messageId));
      const file = message && !message.isContentProtected ? fileOf(message) : null;
      const thumbnail =
        file?.uniqueFileId === request.fileUniqueId
          ? (file.getThumbnail(Thumbnail.THUMB_320x320_BOX) ??
            file.getThumbnail(Thumbnail.THUMB_100x100_BOX))
          : null;
      thumbnails.set(
        request.fileUniqueId,
        thumbnail ? await this.thumbnailBytes(thumbnail, options) : null,
      );
    }
    return thumbnails;
  }

  async openBackupSource(
    fileId: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<BackupSourceFile> {
    const parts = toFileIdParts(fileId);
    options.signal?.throwIfAborted();
    const file = await this.currentFile(parts);
    const size = sizeOf(file.fileSize);
    if (size === null) {
      throw new TelegramError(
        'Telegram does not say how large the file is',
        TelegramErrorCode.TELEGRAM_ERROR,
      );
    }
    return {
      stream: this.sourceStream(parts, file, size, options.signal),
      size,
      attributes: backupAttributesOf(file),
    };
  }

  async uploadBackupFile(
    targetChatId: string,
    input: BackupFileInput,
    options: { signal?: AbortSignal; onProgress?: (uploadedBytes: number) => void } = {},
  ): Promise<UploadedBackupFile> {
    const { onProgress, signal } = options;
    const attributes = input.attributes;
    return translateErrors(async () => {
      // The size limit depends on Premium, which mtcute reads from the cached account.
      if (this.tg.storage.self.getCached(true) === null) {
        await this.tg.getMe();
      }
      const uploaded = await this.tg.uploadFile({
        file: input.stream,
        fileSize: input.size,
        fileName: attributes.fileName ?? defaultFileName(attributes.kind),
        fileMime: attributes.mimeType ?? 'application/octet-stream',
        ...(onProgress ? { progressCallback: (done: number) => onProgress(done) } : {}),
        ...(signal ? { abortSignal: signal } : {}),
      });
      // Stored by Telegram right away: an album sends once all of its files are stored.
      const stored = await this.tg.uploadMedia(backupInputMedia(uploaded, input), {
        peer: toPeerId(targetChatId),
      });
      return uploadedFileOf(stored);
    });
  }

  async sendBackup(
    targetChatId: string,
    payload: BackupPayload,
    options: SendBackupOptions,
  ): Promise<SentBackupMessage[]> {
    const count = payload.kind === 'text' ? 1 : payload.items.length;
    if (count === 0 || count > 10 || options.randomIds.length !== count) {
      throw new TelegramError(
        'A backup sends 1 to 10 messages, each with its own random id',
        TelegramErrorCode.TELEGRAM_ERROR,
      );
    }
    const randomIds = options.randomIds.map((id) => Long.fromString(id.toString()));
    const peer = await translateErrors(() => this.tg.resolvePeer(toPeerId(targetChatId)));
    const replyTo: tl.TypeInputReplyTo | undefined =
      options.threadId === null
        ? undefined
        : { _: 'inputReplyToMessage', replyToMsgId: options.threadId, topMsgId: options.threadId };
    const common = { peer, silent: true, ...(replyTo ? { replyTo } : {}) };
    let updates: tl.TypeUpdates;
    try {
      if (payload.kind === 'text') {
        updates = await this.tg.call({
          _: 'messages.sendMessage',
          ...common,
          message: payload.text.text,
          ...entitiesOf(payload.text.entities),
          noWebpage: payload.disableWebPreview,
          randomId: randomIds[0]!,
        });
      } else if (payload.items.length === 1) {
        const [item] = payload.items;
        updates = await this.tg.call({
          _: 'messages.sendMedia',
          ...common,
          media: storedInputMedia(item!.file),
          message: item!.caption?.text ?? '',
          ...entitiesOf(item!.caption?.entities ?? []),
          randomId: randomIds[0]!,
        });
      } else {
        updates = await this.tg.call({
          _: 'messages.sendMultiMedia',
          ...common,
          multiMedia: payload.items.map((item, index) => ({
            _: 'inputSingleMedia' as const,
            media: storedInputMedia(item.file),
            message: item.caption?.text ?? '',
            ...entitiesOf(item.caption?.entities ?? []),
            randomId: randomIds[index]!,
          })),
        });
      }
    } catch (error) {
      const translated = toTelegramError(error);
      // The stored file of an album member can no longer be used: upload that file again.
      if (translated instanceof FileReferenceExpiredError) {
        throw new UploadIncompleteError('FILE_REFERENCE_EXPIRED', translated.index);
      }
      throw translated;
    }
    this.tg.handleClientUpdate(updates, true);
    return sentMessagesOf(updates, randomIds);
  }

  async createForumTopic(targetChatId: string, title: string): Promise<number> {
    const message = await translateErrors(() =>
      this.tg.createForumTopic({ chatId: toPeerId(targetChatId), title }),
    );
    return message.id;
  }

  async getBackupMessages(
    targetChatId: string,
    messageIds: number[],
  ): Promise<BackupChatMessage[]> {
    if (messageIds.length === 0) {
      return [];
    }
    const messages = await translateErrors(() =>
      this.tg.getMessages(toPeerId(targetChatId), messageIds.slice(0, MAX_HISTORY_PAGE)),
    );
    return messages.flatMap((message) => (message ? [mapBackupChatMessage(message)] : []));
  }

  async getBackupHistory(
    targetChatId: string,
    afterMessageId: number,
    limit = MAX_HISTORY_PAGE,
  ): Promise<BackupChatMessage[]> {
    const messages = await translateErrors(() =>
      this.tg.getHistory(toPeerId(targetChatId), {
        limit: clampLimit(limit),
        reverse: true,
        offset: { id: afterMessageId + 1, date: 0 },
      }),
    );
    return messages
      .filter((message) => message.id > afterMessageId)
      .map(mapBackupChatMessage)
      .sort((a, b) => a.id - b.id);
  }

  async readBackupFileHead(
    targetChatId: string,
    messageId: number,
    bytes: number,
  ): Promise<number> {
    const [message] = await translateErrors(() =>
      this.tg.getMessages(toPeerId(targetChatId), [messageId]),
    );
    if (!message) {
      throw new MediaUnavailableError('MESSAGE_DELETED');
    }
    const file = fileOf(message);
    if (!file) {
      throw new MediaUnavailableError('MEDIA_REPLACED');
    }
    const total = sizeOf(file.fileSize);
    const wanted = Math.max(1, Math.min(bytes, total ?? bytes));
    const stop = new AbortController();
    let read = 0;
    try {
      for await (const chunk of this.tg.downloadAsIterable(file, {
        limit: wanted,
        abortSignal: stop.signal,
        stallTimeout: DEFAULT_STALL_TIMEOUT_MS,
        ...(total === null ? {} : { fileSize: total }),
      })) {
        read += chunk.length;
        if (read >= wanted) {
          break;
        }
      }
    } catch (error) {
      throw toTelegramError(error);
    } finally {
      stop.abort();
    }
    return read;
  }

  async deleteBackupMessages(targetChatId: string, messageIds: number[]): Promise<void> {
    if (messageIds.length === 0) {
      return;
    }
    await translateErrors(() =>
      this.tg.deleteMessagesById(toPeerId(targetChatId), messageIds, { revoke: true }),
    );
  }

  /**
   * The bytes of a file as the upload consumes them: Telegram is read BACKUP_STREAM_BUFFER ahead
   * at most. An expired file reference is fetched again and reading goes on where it stopped
   * (from the last whole MiB, skipping what was already passed on).
   */
  private sourceStream(
    parts: FileIdParts,
    first: MtFile,
    size: number,
    signal?: AbortSignal,
  ): ReadableStream<Uint8Array> {
    let file = first;
    let position = 0;
    let skip = 0;
    let refreshes = 0;
    let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
    const open = (): ReadableStreamDefaultReader<Uint8Array> => {
      const start = alignDown(position);
      skip = position - start;
      return this.tg
        .downloadAsStream(file, {
          offset: start,
          fileSize: size,
          highWaterMark: BACKUP_STREAM_BUFFER,
          ...(signal ? { abortSignal: signal } : {}),
        })
        .getReader();
    };
    return new ReadableStream<Uint8Array>({
      pull: async (controller) => {
        for (;;) {
          reader ??= open();
          try {
            const { value, done } = await reader.read();
            if (done) {
              if (position !== size) {
                throw new TelegramError(
                  `Telegram sent ${position} of ${size} bytes`,
                  TelegramErrorCode.TELEGRAM_ERROR,
                );
              }
              controller.close();
              return;
            }
            let chunk = value;
            if (skip > 0) {
              if (chunk.length <= skip) {
                skip -= chunk.length;
                continue;
              }
              chunk = chunk.subarray(skip);
              skip = 0;
            }
            position += chunk.length;
            controller.enqueue(chunk);
            return;
          } catch (error) {
            signal?.throwIfAborted();
            const translated = toTelegramError(error);
            if (
              !(translated instanceof FileReferenceExpiredError) ||
              refreshes >= MAX_REFERENCE_REFRESHES
            ) {
              throw translated;
            }
            refreshes += 1;
            reader = null;
            file = await this.currentFile(parts);
          }
        }
      },
      cancel: async (reason) => {
        await reader?.cancel(reason);
      },
    });
  }

  /** The file as Telegram has it now (fresh file reference), checked against the archived one. */
  private async currentFile(parts: FileIdParts): Promise<MtFile> {
    const [message] = await translateErrors(() =>
      this.tg.getMessages(toPeerId(parts.chatId), [toMessageId(parts.messageId)]),
    );
    if (!message) {
      throw new MediaUnavailableError('MESSAGE_DELETED');
    }
    if (message.isContentProtected) {
      throw new ChatProtectedError(parts.chatId);
    }
    const file = fileOf(message);
    if (!file || file.uniqueFileId !== parts.fileUniqueId) {
      throw new MediaUnavailableError('MEDIA_REPLACED');
    }
    return file;
  }

  /**
   * One thumbnail, or null when it cannot be had. Only waits and a lost session stop the whole
   * batch. A hard time limit applies: Telegram may answer "-503 Timeout" for a file forever, and
   * mtcute keeps retrying small files without a stall timeout of its own.
   */
  private async thumbnailBytes(
    thumbnail: Thumbnail,
    options: ThumbnailOptions,
  ): Promise<Uint8Array | null> {
    const limit = options.timeoutMs ?? DEFAULT_THUMBNAIL_TIMEOUT_MS;
    const timeout = new AbortController();
    const signal = options.signal
      ? AbortSignal.any([options.signal, timeout.signal])
      : timeout.signal;
    const download = this.tg.downloadAsBuffer(thumbnail, {
      abortSignal: signal,
      stallTimeout: limit,
    });
    // Settled either way below; a late rejection after the time limit must not go unhandled.
    download.catch(() => undefined);
    let timer: NodeJS.Timeout | undefined;
    const timedOut = new Promise<null>((resolve) => {
      timer = setTimeout(() => {
        timeout.abort(new Error('The thumbnail took too long'));
        resolve(null);
      }, limit);
    });
    try {
      return await Promise.race([download, timedOut]);
    } catch (error) {
      options.signal?.throwIfAborted();
      const translated = toTelegramError(error);
      if (translated instanceof FloodWaitError || translated instanceof AuthRequiredError) {
        throw translated;
      }
      return null;
    } finally {
      clearTimeout(timer);
      timeout.abort();
    }
  }
}

function toFileIdParts(fileId: string): FileIdParts {
  try {
    return decodeFileId(fileId);
  } catch {
    throw new TelegramError(`Invalid file id: ${fileId}`, TelegramErrorCode.TELEGRAM_ERROR);
  }
}

function mimeTypeOf(file: MtFile): string | null {
  return file.type === 'photo' ? 'image/jpeg' : (file as MtRawDocument).mimeType || null;
}

function fileNameOf(file: MtFile): string | null {
  return file.type === 'photo' ? null : ((file as MtRawDocument).fileName ?? null);
}

/** A name for a file Telegram has none for (photos, some videos). */
function defaultFileName(kind: BackupFileInput['attributes']['kind']): string {
  switch (kind) {
    case 'photo':
      return 'photo.jpg';
    case 'video':
    case 'animation':
    case 'video_note':
      return 'video.mp4';
    case 'audio':
      return 'audio.mp3';
    case 'voice':
      return 'voice.ogg';
    default:
      return 'file';
  }
}

/** How an uploaded file is described to Telegram, with the attributes of the original. */
function backupInputMedia(uploaded: UploadedFile, input: BackupFileInput): InputMediaLike {
  const attributes = input.attributes;
  const named = {
    ...(attributes.fileName ? { fileName: attributes.fileName } : {}),
    ...(attributes.mimeType ? { fileMime: attributes.mimeType } : {}),
  };
  const thumb = input.thumbnail ? { thumb: input.thumbnail } : {};
  switch (attributes.kind) {
    case 'photo':
      return InputMedia.photo(uploaded);
    case 'video':
    case 'animation':
    case 'video_note':
      return InputMedia.video(uploaded, {
        ...named,
        ...thumb,
        ...(attributes.width === null ? {} : { width: attributes.width }),
        ...(attributes.height === null ? {} : { height: attributes.height }),
        ...(attributes.duration === null ? {} : { duration: attributes.duration }),
        supportsStreaming: attributes.supportsStreaming,
        isAnimated: attributes.kind === 'animation',
        isRound: attributes.kind === 'video_note',
      });
    case 'audio':
      return InputMedia.audio(uploaded, {
        ...named,
        ...thumb,
        ...(attributes.duration === null ? {} : { duration: attributes.duration }),
        ...(attributes.performer ? { performer: attributes.performer } : {}),
        ...(attributes.title ? { title: attributes.title } : {}),
      });
    case 'voice':
      return InputMedia.voice(uploaded, {
        ...(attributes.mimeType ? { fileMime: attributes.mimeType } : {}),
        ...(attributes.duration === null ? {} : { duration: attributes.duration }),
      });
    default:
      return InputMedia.document(uploaded, { ...named, ...thumb });
  }
}

/** The stored photo or document behind an upload, kept so it can be sent later. */
function uploadedFileOf(stored: MtPhoto | MtRawDocument): UploadedBackupFile {
  if (stored instanceof Photo) {
    const input = stored.inputPhoto;
    if (input._ !== 'inputPhoto') {
      throw new TelegramError('Telegram did not store the photo', TelegramErrorCode.TELEGRAM_ERROR);
    }
    return {
      kind: 'photo',
      id: input.id.toString(),
      accessHash: input.accessHash.toString(),
      fileReference: Buffer.from(input.fileReference).toString('base64'),
    };
  }
  const input = stored.inputDocument;
  return {
    kind: 'document',
    id: input.id.toString(),
    accessHash: input.accessHash.toString(),
    fileReference: Buffer.from(input.fileReference).toString('base64'),
  };
}

/** A stored upload as the media of a new message. */
function storedInputMedia(file: UploadedBackupFile): tl.TypeInputMedia {
  const reference = {
    id: Long.fromString(file.id),
    accessHash: Long.fromString(file.accessHash),
    fileReference: new Uint8Array(Buffer.from(file.fileReference, 'base64')),
  };
  return file.kind === 'photo'
    ? { _: 'inputMediaPhoto', id: { _: 'inputPhoto', ...reference } }
    : { _: 'inputMediaDocument', id: { _: 'inputDocument', ...reference } };
}

/** Formatting for a send; Telegram takes no empty list. */
function entitiesOf(entities: readonly MessageEntity[]): { entities?: tl.TypeMessageEntity[] } {
  const converted = toTlEntities(entities);
  return converted.length > 0 ? { entities: converted } : {};
}

/** The ids of the messages a send created, in the order of their random ids. */
function sentMessagesOf(updates: tl.TypeUpdates, randomIds: readonly Long[]): SentBackupMessage[] {
  if (updates._ === 'updateShortSentMessage') {
    return [{ messageId: updates.id, groupedId: null }];
  }
  if (updates._ !== 'updates' && updates._ !== 'updatesCombined') {
    throw new TelegramError(
      'Telegram did not say which messages were sent',
      TelegramErrorCode.TELEGRAM_ERROR,
    );
  }
  const idByRandom = new Map<string, number>();
  const groupOf = new Map<number, string | null>();
  for (const update of updates.updates) {
    if (update._ === 'updateMessageID') {
      idByRandom.set(update.randomId.toString(), update.id);
    } else if (
      (update._ === 'updateNewChannelMessage' || update._ === 'updateNewMessage') &&
      update.message._ === 'message'
    ) {
      groupOf.set(update.message.id, update.message.groupedId?.toString() ?? null);
    }
  }
  return randomIds.map((randomId) => {
    const messageId = idByRandom.get(randomId.toString());
    if (messageId === undefined) {
      throw new TelegramError(
        'Telegram did not say which messages were sent',
        TelegramErrorCode.TELEGRAM_ERROR,
      );
    }
    return { messageId, groupedId: groupOf.get(messageId) ?? null };
  });
}

function fromSentCode(code: SentCode): SendCodeResult {
  if (code.type === 'email_required') {
    throw new LoginStepError(
      TelegramErrorCode.EMAIL_REQUIRED,
      'Telegram asks this account to set up a login email in an official Telegram app first',
    );
  }
  return {
    kind: 'code_sent',
    phoneCodeHash: code.phoneCodeHash,
    codeType: code.type,
    nextCodeType: code.nextType,
    resendAfterSeconds: code.timeout,
  };
}

function clampLimit(limit: number): number {
  return Math.min(Math.max(Math.trunc(limit), 1), MAX_HISTORY_PAGE);
}

/** Date (in seconds) of a message Telegram sent along, if it is there. */
function messageDate(messages: readonly tl.TypeMessage[], id: number): number | null {
  for (const message of messages) {
    if (message.id === id && message._ !== 'messageEmpty') {
      return message.date;
    }
  }
  return null;
}

/** The chat is read from the raw peer: the chat object needs the peer cached, which may not be. */
function messageRef(message: MtMessage): { chatId: string; messageId: string } {
  return { chatId: String(getMarkedPeerId(message.raw.peerId)), messageId: String(message.id) };
}

function deletedMessages(update: DeleteMessageUpdate): UpdateEvent {
  return {
    kind: 'delete_messages',
    chatId: update.channelId === null ? null : String(update.channelId),
    messageIds: update.messageIds.map(String),
  };
}

function toPeerId(chatId: string): number {
  const id = Number(chatId);
  if (!/^-?\d+$/.test(chatId) || !Number.isSafeInteger(id)) {
    throw new TelegramError(`Invalid chat id: ${chatId}`, TelegramErrorCode.TELEGRAM_ERROR);
  }
  return id;
}

function toMessageId(messageId: string): number {
  const id = Number(messageId);
  if (!/^\d+$/.test(messageId) || !Number.isSafeInteger(id)) {
    throw new TelegramError(`Invalid message id: ${messageId}`, TelegramErrorCode.TELEGRAM_ERROR);
  }
  return id;
}
