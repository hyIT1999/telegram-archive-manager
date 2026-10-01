import { MtArgumentError, MtPeerNotFoundError, MtTimeoutError, MtUnsupportedError, tl } from '@mtcute/core';
import { describe, expect, it } from 'vitest';
import {
  AuthRequiredError,
  ChatUnavailableError,
  EntitiesRejectedError,
  FileReferenceExpiredError,
  FileTooLargeError,
  FloodWaitError,
  LoginStepError,
  TelegramError,
  TelegramTimeoutError,
  UploadIncompleteError,
  toTelegramError,
} from '../src/index.js';

function rpc(code: number, message: string): tl.RpcError {
  return tl.RpcError.fromTl({ errorCode: code, errorMessage: message });
}

describe('toTelegramError', () => {
  it('turns FLOOD_WAIT_X into FloodWaitError with the wait time', () => {
    const error = toTelegramError(rpc(420, 'FLOOD_WAIT_42'));
    expect(error).toBeInstanceOf(FloodWaitError);
    expect((error as FloodWaitError).seconds).toBe(42);
  });

  it('recognizes expired file references and revoked sessions', () => {
    expect(toTelegramError(rpc(400, 'FILE_REFERENCE_EXPIRED'))).toBeInstanceOf(FileReferenceExpiredError);
    expect(toTelegramError(rpc(400, 'FILE_REFERENCE_3_EXPIRED'))).toBeInstanceOf(FileReferenceExpiredError);
    for (const text of ['AUTH_KEY_UNREGISTERED', 'SESSION_REVOKED', 'USER_DEACTIVATED']) {
      expect(toTelegramError(rpc(401, text))).toBeInstanceOf(AuthRequiredError);
    }
  });

  it('recognizes stalled downloads and references that need fetching again', () => {
    expect(toTelegramError(new MtTimeoutError(120_000))).toBeInstanceOf(TelegramTimeoutError);
    expect(toTelegramError(new MtUnsupportedError('File ref expired!'))).toBeInstanceOf(FileReferenceExpiredError);
    expect(toTelegramError(rpc(420, 'FLOOD_PREMIUM_WAIT_7'))).toMatchObject({ seconds: 7 });
  });

  it('recognizes chats the account can no longer read', () => {
    for (const text of ['CHANNEL_PRIVATE', 'CHANNEL_INVALID', 'CHAT_FORBIDDEN', 'PEER_ID_INVALID']) {
      const error = toTelegramError(rpc(400, text));
      expect(error, text).toBeInstanceOf(ChatUnavailableError);
      expect((error as ChatUnavailableError).code, text).toBe('CHAT_UNAVAILABLE');
    }
    const unknownPeer = toTelegramError(new MtPeerNotFoundError('Peer -100123 is not found in local cache'));
    expect(unknownPeer).toBeInstanceOf(ChatUnavailableError);
    expect(unknownPeer.message).toMatch(/refresh the chat list/);
  });

  it('maps login failures to stable codes', () => {
    const cases: [string, string][] = [
      ['PHONE_NUMBER_INVALID', 'PHONE_NUMBER_INVALID'],
      ['PHONE_CODE_INVALID', 'PHONE_CODE_INVALID'],
      ['PHONE_CODE_EXPIRED', 'PHONE_CODE_EXPIRED'],
      ['PASSWORD_HASH_INVALID', 'PASSWORD_INVALID'],
      ['PHONE_NUMBER_UNOCCUPIED', 'SIGN_UP_REQUIRED'],
      ['PHONE_NUMBER_FLOOD', 'FLOOD_WAIT'],
    ];
    for (const [text, code] of cases) {
      const error = toTelegramError(rpc(400, text));
      expect(error, text).toBeInstanceOf(LoginStepError);
      expect((error as LoginStepError).code, text).toBe(code);
    }
  });

  it('maps mtcute sign-in restrictions', () => {
    const payment = toTelegramError(
      new MtArgumentError('Payment is required to sign in, please log in with a first-party client first'),
    );
    expect((payment as LoginStepError).code).toBe('PAYMENT_REQUIRED');
    const signUp = toTelegramError(new MtUnsupportedError('Signup is no longer supported by Telegram for non-official clients'));
    expect((signUp as LoginStepError).code).toBe('SIGN_UP_REQUIRED');
  });

  it('tells what went wrong while sending a backup', () => {
    const expired = toTelegramError(rpc(400, 'FILE_REFERENCE_2_EXPIRED'));
    expect(expired).toMatchObject({ index: 2 });
    expect(toTelegramError(rpc(400, 'FILE_REFERENCE_EXPIRED'))).toMatchObject({ index: null });
    const missing = toTelegramError(rpc(400, 'FILE_PART_5_MISSING'));
    expect(missing).toBeInstanceOf(UploadIncompleteError);
    expect(missing.message).toContain('FILE_PART_5_MISSING');
    expect(toTelegramError(rpc(400, 'FILE_PARTS_INVALID'))).toBeInstanceOf(UploadIncompleteError);
    expect(toTelegramError(rpc(400, 'ENTITY_BOUNDS_INVALID'))).toBeInstanceOf(EntitiesRejectedError);
    expect(toTelegramError(rpc(420, 'FLOOD_PREMIUM_WAIT_7'))).toMatchObject({ seconds: 7 });
    expect(
      toTelegramError(new MtArgumentError('File is too large (max 4000 parts, got 5000)')),
    ).toBeInstanceOf(FileTooLargeError);
  });

  it('keeps unknown Telegram errors recognizable and other errors untouched', () => {
    const unknown = toTelegramError(rpc(400, 'SOMETHING_NEW'));
    expect(unknown).toBeInstanceOf(TelegramError);
    expect((unknown as TelegramError).code).toBe('TELEGRAM_ERROR');
    expect(unknown.message).toContain('SOMETHING_NEW');

    const bug = new TypeError('boom');
    expect(toTelegramError(bug)).toBe(bug);
  });
});
