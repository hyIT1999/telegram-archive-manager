import { ApiErrorCode } from '@tam/shared';
import {
  type Chat,
  TelegramError,
  type TelegramHistoryReader,
  type TelegramLoginApi,
  type TelegramMediaReader,
} from '@tam/telegram';

/** TelegramSettings, derived from the environment. */
export const TELEGRAM_SETTINGS = Symbol('TELEGRAM_SETTINGS');
/** SecretBox for login state at rest, or null when Telegram is not configured. */
export const SECRET_BOX = Symbol('SECRET_BOX');
/** ioredis command connection for the Telegram module (lease, flags, RPC replies). */
export const TELEGRAM_REDIS = Symbol('TELEGRAM_REDIS');
/** Gives services the live Telegram API (TelegramConnection in production, fakes in tests). */
export const TELEGRAM_API_PROVIDER = Symbol('TELEGRAM_API_PROVIDER');

/** The adapter operations the worker uses: login, the chat list, history and media files. */
export interface TelegramApi extends TelegramLoginApi, TelegramHistoryReader, TelegramMediaReader {
  getChats(): Promise<Chat[]>;
}

export interface TelegramApiProvider {
  /** Throws TelegramUnavailableError when there is no live connection. */
  readonly api: TelegramApi;
}

/** This worker holds no live Telegram connection (not configured, on standby, reconnecting). */
export class TelegramUnavailableError extends TelegramError {
  constructor(message = 'The worker is not connected to Telegram') {
    super(message, ApiErrorCode.TELEGRAM_UNAVAILABLE);
  }
}
