import { MtArgumentError, MtUnsupportedError, tl } from '@mtcute/core';
import { TelegramErrorCode } from '@tam/shared';
import {
  AuthRequiredError,
  ChatProtectedError,
  FileReferenceExpiredError,
  FloodWaitError,
  LoginStepError,
  TelegramError,
} from '../errors.js';

/** Telegram answers meaning the stored session is gone. */
const SESSION_GONE = new Set([
  'AUTH_KEY_UNREGISTERED',
  'AUTH_KEY_INVALID',
  'AUTH_KEY_PERM_EMPTY',
  'SESSION_REVOKED',
  'SESSION_EXPIRED',
  'USER_DEACTIVATED',
  'USER_DEACTIVATED_BAN',
]);

const LOGIN_ERRORS: Readonly<Record<string, [TelegramErrorCode, string]>> = {
  PHONE_NUMBER_INVALID: [TelegramErrorCode.PHONE_NUMBER_INVALID, 'Telegram does not accept this phone number'],
  PHONE_NUMBER_BANNED: [TelegramErrorCode.PHONE_NUMBER_BANNED, 'This phone number is banned by Telegram'],
  PHONE_NUMBER_UNOCCUPIED: [
    TelegramErrorCode.SIGN_UP_REQUIRED,
    'This phone number has no Telegram account. Create one in an official Telegram app first.',
  ],
  PHONE_CODE_INVALID: [TelegramErrorCode.PHONE_CODE_INVALID, 'The code is not correct'],
  PHONE_CODE_EMPTY: [TelegramErrorCode.PHONE_CODE_INVALID, 'The code is not correct'],
  PHONE_CODE_EXPIRED: [TelegramErrorCode.PHONE_CODE_EXPIRED, 'The code has expired; request a new one'],
  PASSWORD_HASH_INVALID: [TelegramErrorCode.PASSWORD_INVALID, 'The two-step verification password is not correct'],
  PHONE_NUMBER_FLOOD: [TelegramErrorCode.FLOOD_WAIT, 'Too many login attempts for this number; try again later'],
  PHONE_PASSWORD_FLOOD: [TelegramErrorCode.FLOOD_WAIT, 'Too many password attempts; try again later'],
};

/**
 * Translates mtcute/MTProto failures into the adapter's error classes. Anything unknown becomes a
 * TelegramError carrying Telegram's own error text, so it is never mistaken for a bug in our code.
 */
export function toTelegramError(error: unknown): Error {
  if (error instanceof TelegramError) {
    return error;
  }
  if (tl.RpcError.is(error)) {
    return fromRpcError(error);
  }
  if (error instanceof MtArgumentError && /payment is required/i.test(error.message)) {
    return new LoginStepError(
      TelegramErrorCode.PAYMENT_REQUIRED,
      'Telegram requires this number to log in with an official Telegram app first',
    );
  }
  if (error instanceof MtUnsupportedError && /sign.?up/i.test(error.message)) {
    return new LoginStepError(
      TelegramErrorCode.SIGN_UP_REQUIRED,
      'This phone number has no Telegram account. Create one in an official Telegram app first.',
    );
  }
  return error instanceof Error ? error : new Error(String(error));
}

function fromRpcError(error: tl.RpcError): TelegramError {
  const text = String(error.text);
  const seconds = (error as { seconds?: unknown }).seconds;
  if (/_WAIT_%d$/.test(text) && typeof seconds === 'number' && text !== '2FA_CONFIRM_WAIT_%d') {
    return new FloodWaitError(seconds);
  }
  if (text.startsWith('FILE_REFERENCE_')) {
    return new FileReferenceExpiredError();
  }
  if (SESSION_GONE.has(text)) {
    return new AuthRequiredError();
  }
  if (text === 'CHAT_FORWARDS_RESTRICTED') {
    return new ChatProtectedError('unknown');
  }
  const login = LOGIN_ERRORS[text];
  if (login) {
    return new LoginStepError(login[0], login[1]);
  }
  return new TelegramError(`Telegram error ${error.code}: ${text}`, TelegramErrorCode.TELEGRAM_ERROR);
}

/** Runs `operation`, translating any failure with toTelegramError. */
export async function translateErrors<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw toTelegramError(error);
  }
}
