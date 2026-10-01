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
  /**
   * The account may post messages with files here: the owner, an admin allowed to post, or (in a
   * supergroup) a member not barred from sending. Such a chat can receive backups.
   */
  canPost: boolean;
  /** The account may create forum topics here. */
  canManageTopics: boolean;
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

/** A topic of a forum supergroup. */
export interface ForumTopic {
  /** Topic id: the id of the service message that created the topic (1 = General). */
  id: number;
  title: string;
  /** RGB colour of the topic icon. */
  iconColor: number | null;
  isClosed: boolean;
  isPinned: boolean;
  /** Only the General topic can be hidden from the topic list. */
  isHidden: boolean;
  /** When the topic was created. */
  date: Date;
  /** This account created the topic. */
  createdByMe: boolean;
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

/**
 * What Telegram announced, by id only: the archive reads messages through history, where content
 * protection and auto-delete timers are checked. `chatId` is the marked id ("-100…" for channels);
 * deletions in basic groups and private chats carry no chat (null).
 */
export type UpdateEvent =
  | { kind: 'new_message'; chatId: string; messageId: string }
  | { kind: 'edit_message'; chatId: string; messageId: string }
  | { kind: 'delete_messages'; chatId: string | null; messageIds: string[] };

export type UpdateHandler = (event: UpdateEvent) => void | Promise<void>;

// ---------------------------------------------------------------------------
// Backups: copies of archived messages sent as NEW messages to a chat of the account's.
// ---------------------------------------------------------------------------

/** How a file is sent again, with the attributes Telegram shows (player, duration, name…). */
export interface BackupFileAttributes {
  kind: 'photo' | 'video' | 'animation' | 'video_note' | 'audio' | 'voice' | 'document';
  fileName: string | null;
  mimeType: string | null;
  width: number | null;
  height: number | null;
  /** Seconds. */
  duration: number | null;
  /** A video that can play before it is fully downloaded. */
  supportsStreaming: boolean;
  /** Audio only. */
  performer: string | null;
  title: string | null;
}

/** The file of an archived message, opened for uploading again. */
export interface BackupSourceFile {
  /** Its bytes, read from Telegram as the upload consumes them (never stored on disk). */
  stream: ReadableStream<Uint8Array>;
  size: number;
  attributes: BackupFileAttributes;
}

/** What to upload: the bytes (from Telegram or from a downloaded copy) and how to send them. */
export interface BackupFileInput {
  stream: ReadableStream<Uint8Array>;
  size: number;
  attributes: BackupFileAttributes;
  /** JPEG, at most 200 KB and 320 px, shown before a video loads; null for none. */
  thumbnail: Uint8Array | null;
}

/**
 * A file uploaded for a backup chat and stored by Telegram, not sent yet. JSON-safe, so an album
 * that is interrupted keeps the files already uploaded.
 */
export interface UploadedBackupFile {
  kind: 'photo' | 'document';
  id: string;
  accessHash: string;
  /** Base64. */
  fileReference: string;
}

/** Text with its formatting, as the archive stored it. */
export interface BackupText {
  text: string;
  entities: MessageEntity[];
}

export interface BackupMediaItem {
  file: UploadedBackupFile;
  caption: BackupText | null;
}

/** One new message: a text, one file, or an album (up to 10 files, each with its caption). */
export type BackupPayload =
  | { kind: 'text'; text: BackupText; disableWebPreview: boolean }
  | { kind: 'media'; items: BackupMediaItem[] };

export interface SendBackupOptions {
  /** The forum topic of the backup chat; null outside forums (and for General). */
  threadId: number | null;
  /**
   * One per message to send, stored before sending: Telegram refuses a random id it has seen,
   * so repeating a send whose outcome is unknown cannot post twice.
   */
  randomIds: readonly bigint[];
}

/** A message the backup chat received, in the order of the random ids. */
export interface SentBackupMessage {
  messageId: number;
  /** Album id in the backup chat. */
  groupedId: string | null;
}

/** A message of a backup chat, as Verify and crash recovery read it. */
export interface BackupChatMessage {
  id: number;
  date: Date;
  /** Sent by this account. */
  isOutgoing: boolean;
  /** Carries a "Forwarded from" header (a backup never does). */
  isForwarded: boolean;
  isService: boolean;
  groupedId: string | null;
  /** Forum topic; null outside forums and in General. */
  threadId: number | null;
  /** The text, or the caption of a file. */
  text: string;
  media: {
    type: MediaType | null;
    fileName: string | null;
    size: number | null;
    fileUniqueId: string;
    width: number | null;
    height: number | null;
  } | null;
}
