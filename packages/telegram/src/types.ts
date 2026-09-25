import type { ChatType, MediaType, MessageType, TelegramAuthState } from '@tam/shared';

/** A channel or group the logged-in account can access. Ids are decimal strings (marked ids). */
export interface Chat {
  /** Marked id: -100… for channels/supergroups, -id for basic groups. */
  id: string;
  title: string;
  username: string | null;
  type: ChatType;
  accessHash: string | null;
  isForum: boolean;
  /** Telegram content protection (noforwards) — such chats are never archived. */
  isProtected: boolean;
  memberCount: number | null;
  /** Marked id of the basic group this supergroup was upgraded from. */
  migratedFromChatId: string | null;
}

export interface MessageEntity {
  kind: string;
  offset: number;
  length: number;
  params?: Record<string, unknown>;
}

export interface ForwardInfo {
  date: Date;
  fromChatId: string | null;
  fromMessageId: string | null;
  senderName: string | null;
}

export interface MessageMedia {
  /** Opaque adapter id `chatId:messageId:fileUniqueId` (see file-id.ts). */
  fileId: string;
  /** Stable file identity (Bot-API/TDLib compatible file_unique_id). */
  fileUniqueId: string;
  type: MediaType;
  fileName: string | null;
  mimeType: string | null;
  size: number | null;
  width: number | null;
  height: number | null;
  /** Seconds. */
  duration: number | null;
  hasThumbnail: boolean;
  /** Self-destructing (TTL / view-once) media is never downloaded. */
  isSelfDestructing: boolean;
}

export interface Message {
  /** Server message id (the id used in t.me links). */
  id: string;
  chatId: string;
  date: Date;
  editDate: Date | null;
  type: MessageType;
  /** Set when the message has no media. */
  text: string | null;
  /** Set when the message has media (MTProto keeps both in one field). */
  caption: string | null;
  entities: MessageEntity[] | null;
  replyToMessageId: string | null;
  threadId: string | null;
  mediaGroupId: string | null;
  forward: ForwardInfo | null;
  views: number | null;
  isService: boolean;
  isContentProtected: boolean;
  /** Auto-delete timer in seconds; such messages are skipped. */
  ttlPeriod: number | null;
  media: MessageMedia[];
  /** Additional original-message info (post author, forwards count, …). */
  meta: Record<string, unknown>;
}

export interface HistoryPageOptions {
  /** Only messages strictly older than this id (exclusive cursor). */
  beforeMessageId?: string;
  /** Only messages sent before this moment; ignored when `beforeMessageId` is set. */
  beforeDate?: Date;
  /** At most this many messages (capped at 100). */
  limit?: number;
}

/** One page of history plus Telegram's count of the chat's messages (for import progress). */
export interface HistoryPage {
  /** Newest → oldest. Empty when the start of the history was reached. */
  messages: Message[];
  /** Messages in the whole chat. Only meaningful for pages read without a cursor. */
  total: number;
}

/**
 * The basic group a supergroup was upgraded from. Its messages stay there, with their own ids,
 * so the archive keeps them in a separate channel row.
 */
export interface LegacyGroup {
  /** Marked id (-id). */
  id: string;
  title: string;
  /** Content protection of the old group; such history is never archived. */
  isProtected: boolean;
}

export interface TelegramUser {
  id: string;
  username: string | null;
  displayName: string;
}

export interface AuthState {
  state: TelegramAuthState;
  user: TelegramUser | null;
  phoneMasked: string | null;
  /** How the pending code was delivered (app, sms, …). */
  codeType: string | null;
  nextCodeType: string | null;
  codeExpiresAt: Date | null;
}

export interface DownloadOptions {
  /** Target file; the adapter writes/appends to it (resume). */
  destPath?: string;
  /** Resume offset in bytes (aligned by the adapter). */
  offset?: number;
  onProgress?: (downloadedBytes: number, totalBytes: number | null) => void;
  signal?: AbortSignal;
  /**
   * Give up with TelegramTimeoutError when no data arrives for this long (Telegram keeps asking
   * to wait, or the connection stalled). The part downloaded so far stays in `destPath`.
   */
  stallTimeoutMs?: number;
}

/** A file whose thumbnail is wanted, as the archive knows it. */
export interface ThumbnailRequest {
  messageId: string;
  fileUniqueId: string;
}

export interface ThumbnailOptions {
  signal?: AbortSignal;
  /** Give up on one thumbnail after this long (it then has no preview). */
  timeoutMs?: number;
}

export interface DownloadedFile {
  path: string;
  size: number;
  mimeType: string | null;
  fileName: string | null;
}

export type UpdateEvent =
  | { kind: 'new_message'; message: Message }
  | { kind: 'edit_message'; message: Message }
  | { kind: 'delete_messages'; chatId: string | null; messageIds: string[] };

export type UpdateHandler = (event: UpdateEvent) => void | Promise<void>;
