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

/** Telegram asked us to wait (FLOOD_WAIT_X). The job is delayed, not failed. */
export class FloodWaitError extends TelegramError {
  constructor(readonly seconds: number) {
    super(`Telegram rate limit: wait ${seconds}s`, 'FLOOD_WAIT');
  }
}

/** The file reference expired; refetch the message and resume the download. */
export class FileReferenceExpiredError extends TelegramError {
  constructor() {
    super('File reference expired', 'FILE_REFERENCE_EXPIRED');
  }
}

/** The chat has content protection enabled; it must not be archived. */
export class ChatProtectedError extends TelegramError {
  constructor(readonly chatId: string) {
    super(`Chat ${chatId} has content protection enabled`, 'CHAT_PROTECTED');
  }
}

/** The session is missing, revoked or unregistered — the user has to log in again. */
export class AuthRequiredError extends TelegramError {
  constructor(reason = 'Telegram login required') {
    super(reason, 'AUTH_REQUIRED');
  }
}

/** A login step was rejected (wrong code, expired code, wrong password, …). */
export class LoginStepError extends TelegramError {}
