import type { TelegramUser } from './types.js';

export type SendCodeResult =
  | {
      kind: 'code_sent';
      phoneCodeHash: string;
      /** app, sms, call, … */
      codeType: string;
      /** What a resend would use; 'none' when nothing else is available. */
      nextCodeType: string;
      /** Seconds until another code may be requested. */
      resendAfterSeconds: number;
    }
  /** Telegram logged in directly (e.g. with a saved future-auth token). */
  | { kind: 'authorized'; user: TelegramUser };

export type SignInResult =
  | { kind: 'authorized'; user: TelegramUser }
  | { kind: 'password_required' };

/**
 * Stateless login primitives of the adapter. The worker's auth service turns them into the
 * persistent, resumable state machine behind TelegramAuthFlow (phone → code → password).
 */
export interface TelegramLoginApi {
  /** The logged-in account, or null when the stored session is missing or was revoked. */
  getAuthorizedUser(): Promise<TelegramUser | null>;
  sendCode(phoneNumber: string): Promise<SendCodeResult>;
  resendCode(phoneNumber: string, phoneCodeHash: string): Promise<SendCodeResult>;
  signIn(phoneNumber: string, phoneCodeHash: string, code: string): Promise<SignInResult>;
  checkPassword(password: string): Promise<TelegramUser>;
  logOut(): Promise<void>;
}
