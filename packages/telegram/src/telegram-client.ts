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
  SendBackupOptions,
  SentBackupMessage,
  ThumbnailOptions,
  ThumbnailRequest,
  UpdateHandler,
  UploadedBackupFile,
} from './types.js';

/**
 * The Telegram abstraction used by the worker. Names and parameter order follow the project
 * specification; deviations:
 * - `authenticate()` resolves to the current AuthState (web login needs to know the next step);
 * - `downloadFile` / `subscribeUpdates` take optional extra arguments, so calls written against
 *   the original signatures still type-check.
 */
export interface TelegramClient {
  /** Connects and restores the stored session, reporting where the login flow stands. */
  authenticate(): Promise<AuthState>;

  /** Channels, supergroups and basic groups the account can access. */
  getChats(): Promise<Chat[]>;

  /**
   * One page of history, newest → oldest, strictly older than `fromMessageId`
   * (or starting at the newest message). `limit` is capped at 100. An empty array
   * means the start of the history was reached.
   */
  getChatHistory(chatId: string, fromMessageId?: string, limit?: number): Promise<Message[]>;

  /** Downloads a media file (resumable through `options.offset`). */
  downloadFile(fileId: string, options?: DownloadOptions): Promise<DownloadedFile>;

  /** Starts delivering new/edited/deleted message updates to `handler`. */
  subscribeUpdates(handler?: UpdateHandler): Promise<void>;
}

/** Web-driven login: each step arrives in a separate HTTP request. */
export interface TelegramAuthFlow {
  submitPhone(phoneNumber: string): Promise<AuthState>;
  submitCode(code: string): Promise<AuthState>;
  resendCode(): Promise<AuthState>;
  submitPassword(password: string): Promise<AuthState>;
  logout(): Promise<void>;
}

/** History access for imports and sync, and for refreshing expired file references. */
export interface TelegramHistoryReader {
  /** Like getChatHistory, with Telegram's message count of the chat and a date cursor. */
  getHistoryPage(chatId: string, options?: HistoryPageOptions): Promise<HistoryPage>;
  /** Messages with id > afterMessageId, oldest → newest, at most `limit` (≤ 100). */
  getNewerMessages(chatId: string, afterMessageId: string, limit?: number): Promise<Message[]>;
  getMessages(chatId: string, messageIds: string[]): Promise<Message[]>;
  /** The chat as Telegram has it now, including the basic group it was upgraded from. */
  refreshChat(chatId: string): Promise<Chat>;
  /** The old basic group of an upgraded supergroup; null when this account cannot read it. */
  getLegacyGroup(chatId: string): Promise<LegacyGroup | null>;
  /**
   * Every topic of a forum supergroup (the General topic included), in Telegram's order.
   * Throws NotAForumError when the chat has no topics.
   */
  getForumTopics(chatId: string): Promise<ForumTopic[]>;
}

/** Media downloads of the archive. */
export interface TelegramMediaReader {
  /**
   * Downloads a file into `options.destPath`, resuming after `options.offset` bytes (rounded down
   * to a multiple of 1 MiB; the rest is fetched again). The message is read again first, so the
   * file reference is always fresh. Throws MediaUnavailableError when the message was deleted or
   * now carries another file, and ChatProtectedError when content protection was turned on.
   */
  downloadFile(fileId: string, options?: DownloadOptions): Promise<DownloadedFile>;
  /**
   * Small previews (320 px box, else 100 px) of files of one chat, by file_unique_id: the image
   * bytes, or null when the file has no preview (or its message is gone). At most 100 files.
   */
  getThumbnails(
    chatId: string,
    files: readonly ThumbnailRequest[],
    options?: ThumbnailOptions,
  ): Promise<Map<string, Uint8Array | null>>;
}

/**
 * Backup copies of archived messages, sent as NEW messages to a chat of the account's: never a
 * forward, and every file is uploaded again (its bytes come from Telegram or from a downloaded
 * copy, streamed, never stored on disk).
 */
export interface TelegramBackupWriter {
  /**
   * Opens the file of an archived message for uploading again: the message is read first (a fresh
   * file reference; MediaUnavailableError when it is gone or now carries another file,
   * ChatProtectedError under content protection), then its bytes stream as they are consumed.
   */
  openBackupSource(fileId: string, options?: { signal?: AbortSignal }): Promise<BackupSourceFile>;
  /**
   * Uploads one file for `targetChatId` and has Telegram store it, without sending anything yet
   * (an album is sent once all of its files are stored).
   */
  uploadBackupFile(
    targetChatId: string,
    input: BackupFileInput,
    options?: { signal?: AbortSignal; onProgress?: (uploadedBytes: number) => void },
  ): Promise<UploadedBackupFile>;
  /**
   * Sends one new message (a text, a file, or an album) silently. The ids of what arrived come
   * back in the order of `options.randomIds`. RandomIdDuplicateError: it was sent already.
   */
  sendBackup(
    targetChatId: string,
    payload: BackupPayload,
    options: SendBackupOptions,
  ): Promise<SentBackupMessage[]>;
  /** Creates a forum topic and returns its id. */
  createForumTopic(targetChatId: string, title: string): Promise<number>;
  /** Messages of a backup chat by id (missing ones are left out). */
  getBackupMessages(targetChatId: string, messageIds: number[]): Promise<BackupChatMessage[]>;
  /** Messages of a backup chat newer than `afterMessageId`, oldest first, at most `limit` (≤ 100). */
  getBackupHistory(
    targetChatId: string,
    afterMessageId: number,
    limit?: number,
  ): Promise<BackupChatMessage[]>;
  /** Downloads the first `bytes` bytes of a backup message's file; returns how many arrived. */
  readBackupFileHead(targetChatId: string, messageId: number, bytes: number): Promise<number>;
  /** Deletes messages of a backup chat (earlier copies replaced by new ones). */
  deleteBackupMessages(targetChatId: string, messageIds: number[]): Promise<void>;
}
