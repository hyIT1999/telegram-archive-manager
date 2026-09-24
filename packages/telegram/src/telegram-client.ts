import type {
  AuthState,
  Chat,
  DownloadOptions,
  DownloadedFile,
  Message,
  UpdateHandler,
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

/** Extra history access needed for sync and for refreshing expired file references. */
export interface TelegramHistoryReader {
  /** Messages with id > afterMessageId, oldest → newest, at most `limit` (≤ 100). */
  getNewerMessages(chatId: string, afterMessageId: string, limit?: number): Promise<Message[]>;
  getMessages(chatId: string, messageIds: string[]): Promise<Message[]>;
  refreshChat(chatId: string): Promise<Chat>;
}
