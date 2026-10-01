import { TelegramErrorCode } from '@tam/shared';

/** Base class for adapter errors the worker reacts to explicitly. */
export class TelegramError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

/** Telegram asked us to wait (FLOOD_WAIT_X). Jobs are delayed, not failed. */
export class FloodWaitError extends TelegramError {
  constructor(readonly seconds: number) {
    super(`Telegram asks to wait ${seconds} s before trying again`, TelegramErrorCode.FLOOD_WAIT);
  }
}

/** The file reference expired; refetch the message and resume the download. */
export class FileReferenceExpiredError extends TelegramError {
  constructor(
    /** Which file of the request (an album), when Telegram says. */
    readonly index: number | null = null,
  ) {
    super('File reference expired', 'FILE_REFERENCE_EXPIRED');
  }
}

/** Why a file can no longer be downloaded. */
export type MediaUnavailableReason = 'MESSAGE_DELETED' | 'MEDIA_REPLACED';

/** The file's message was deleted on Telegram, or it now carries a different file. */
export class MediaUnavailableError extends TelegramError {
  constructor(readonly reason: MediaUnavailableReason) {
    super(
      reason === 'MESSAGE_DELETED'
        ? 'The message was deleted on Telegram'
        : 'The message on Telegram now carries a different file',
      'MEDIA_UNAVAILABLE',
    );
  }
}

/** No data arrived for too long: Telegram kept asking to wait, or the connection stalled. */
export class TelegramTimeoutError extends TelegramError {
  constructor(message = 'Telegram sent no data for too long') {
    super(message, 'TELEGRAM_TIMEOUT');
  }
}

/** The chat has content protection enabled; it must not be archived. */
export class ChatProtectedError extends TelegramError {
  constructor(readonly chatId: string) {
    super(`Chat ${chatId} has content protection enabled`, TelegramErrorCode.CHAT_PROTECTED);
  }
}

/** The account can no longer read the chat: it left, was banned, or the chat was deleted. */
export class ChatUnavailableError extends TelegramError {
  constructor(message = 'This Telegram account can no longer read the chat') {
    super(message, TelegramErrorCode.CHAT_UNAVAILABLE);
  }
}

/** The chat is not a forum (any more), so it has no topics. */
export class NotAForumError extends TelegramError {
  constructor(message = 'This chat is not a forum, so it has no topics') {
    super(message, TelegramErrorCode.NOT_A_FORUM);
  }
}

/** The session is missing, revoked or unregistered — the user has to log in again. */
export class AuthRequiredError extends TelegramError {
  constructor(reason = 'The Telegram session is no longer valid; log in again') {
    super(reason, TelegramErrorCode.SESSION_REVOKED);
  }
}

/** A login step was rejected (wrong code, expired code, wrong password, …). */
export class LoginStepError extends TelegramError {
  constructor(code: TelegramErrorCode, message: string) {
    super(message, code);
  }
}

/**
 * The account may not post (files) in the chat: it lost its admin rights, was banned, or the chat
 * restricts sending. Fixed in Telegram, not by retrying.
 */
export class ChatWriteForbiddenError extends TelegramError {
  constructor(message = 'This Telegram account may not post in the backup chat') {
    super(message, 'CHAT_WRITE_FORBIDDEN');
  }
}

/** Telegram's anti-spam limit for this account (PEER_FLOOD): sending must stop for hours. */
export class PeerFloodError extends TelegramError {
  constructor() {
    super('Telegram limits how much this account may send right now (PEER_FLOOD)', 'PEER_FLOOD');
  }
}

/** The forum topic to post in was deleted or closed. */
export class TopicUnavailableError extends TelegramError {
  constructor(message = 'The forum topic was deleted or closed') {
    super(message, 'TOPIC_UNAVAILABLE');
  }
}

/** The caption is longer than Telegram accepts with a file from this account. */
export class CaptionTooLongError extends TelegramError {
  constructor() {
    super('The caption is longer than Telegram accepts with a file', 'CAPTION_TOO_LONG');
  }
}

/** Telegram refused the formatting of a text (ENTITY_*); the text goes without it. */
export class EntitiesRejectedError extends TelegramError {
  constructor(reason: string) {
    super(`Telegram refused the formatting of the text (${reason})`, 'ENTITIES_REJECTED');
  }
}

/** A part of an uploaded file is missing on Telegram's side: upload that file again. */
export class UploadIncompleteError extends TelegramError {
  constructor(
    reason: string,
    /** Index of the album file concerned, when Telegram says. */
    readonly fileIndex: number | null = null,
  ) {
    super(`Telegram lost part of an uploaded file (${reason})`, 'UPLOAD_INCOMPLETE');
  }
}

/** A random id was sent before: the message it belongs to was already posted. */
export class RandomIdDuplicateError extends TelegramError {
  constructor() {
    super('This message was already sent (RANDOM_ID_DUPLICATE)', 'RANDOM_ID_DUPLICATE');
  }
}

/** Larger than Telegram accepts from this account (2000 MiB, or 4000 MiB with Premium). */
export class FileTooLargeError extends TelegramError {
  constructor(message = 'The file is larger than Telegram accepts from this account') {
    super(message, 'FILE_TOO_LARGE');
  }
}
