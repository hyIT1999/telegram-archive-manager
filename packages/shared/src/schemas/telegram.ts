import { z } from 'zod';
import type { ChatType, TelegramAuthState } from '../enums.js';
import { telegramIdSchema } from './common.js';

const PHONE_HINT = 'Enter the phone number in international format, e.g. +84 912 345 678';

/** International phone number, normalized to E.164 (`+` and 7–15 digits). */
export const phoneNumberSchema = z
  .string()
  .trim()
  .regex(/^\+?[0-9\s().-]{6,24}$/, PHONE_HINT)
  .transform((value) => `+${value.replace(/\D/g, '')}`)
  .pipe(z.string().regex(/^\+[1-9][0-9]{6,14}$/, PHONE_HINT));

/** Login codes are usually 5 digits; newer delivery types (e.g. sms_word) may use letters. */
export const loginCodeSchema = z
  .string()
  .trim()
  .regex(/^[0-9A-Za-z][0-9A-Za-z -]{2,63}$/, 'Enter the code Telegram sent you');

/** Key of the single telegram_accounts row (single-tenant deployment). */
export const TELEGRAM_ACCOUNT_KEY = 'default';

/** One step of the web-driven Telegram login (POST /api/telegram/authenticate). */
export const telegramAuthenticateRequestSchema = z.discriminatedUnion('step', [
  z.object({ step: z.literal('phone'), phoneNumber: phoneNumberSchema }),
  z.object({ step: z.literal('code'), code: loginCodeSchema }),
  z.object({ step: z.literal('password'), password: z.string().min(1).max(256) }),
  z.object({ step: z.literal('resend') }),
]);
export type TelegramAuthenticateRequest = z.infer<typeof telegramAuthenticateRequestSchema>;

/** Where the worker's Telegram connection stands (reported through its heartbeat). */
export const TelegramConnectionState = {
  /** TELEGRAM_API_ID / TELEGRAM_API_HASH (or the session settings) are missing on the worker. */
  UNCONFIGURED: 'UNCONFIGURED',
  /** Another worker process owns the Telegram connection; this one waits. */
  STANDBY: 'STANDBY',
  CONNECTING: 'CONNECTING',
  CONNECTED: 'CONNECTED',
  ERROR: 'ERROR',
} as const;
export type TelegramConnectionState =
  (typeof TelegramConnectionState)[keyof typeof TelegramConnectionState];

export interface TelegramUserDto {
  id: string;
  username: string | null;
  displayName: string;
}

export interface TelegramStatusDto {
  worker: 'online' | 'offline';
  /** null while the worker is offline. */
  connection: TelegramConnectionState | null;
  connectionDetail: string | null;
  state: TelegramAuthState;
  user: TelegramUserDto | null;
  /** e.g. +84•••••••78 — the full number never leaves the worker. */
  phoneMasked: string | null;
  /** How the pending code was delivered: app, sms, call, … */
  codeType: string | null;
  /** What a resend would use; 'none' when no other channel is available. */
  nextCodeType: string | null;
  /** When a new code may be requested. */
  codeResendAt: string | null;
  lastError: string | null;
  dialogsRefreshedAt: string | null;
}

export interface TelegramDialogDto {
  telegramChatId: string;
  title: string;
  username: string | null;
  type: ChatType;
  isProtected: boolean;
  isForum: boolean;
  memberCount: number | null;
  /** The archive channel created from this chat, if any. */
  archivedChannelId: string | null;
  lastSeenAt: string;
}

export interface TelegramDialogListDto {
  items: TelegramDialogDto[];
  /** True while the worker is re-reading the chat list from Telegram. */
  refreshing: boolean;
  refreshedAt: string | null;
}

/** POST /api/channels — the chat must come from the cached dialog list. */
export const createChannelRequestSchema = z.object({ telegramChatId: telegramIdSchema });
export type CreateChannelRequest = z.infer<typeof createChannelRequestSchema>;
