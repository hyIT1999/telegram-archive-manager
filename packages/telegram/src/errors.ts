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
  constructor() {
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
