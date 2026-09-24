import type { LogLevelName, WorkerEnv } from '../config/env.schema.js';

/** Sent to Telegram in initConnection; shown with the device name under Settings → Devices. */
export const APP_VERSION = '0.2.0';

export type TelegramSettings =
  | {
      configured: true;
      apiId: number;
      apiHash: string;
      sessionDatabaseUrl: string;
      sessionKey: string;
    }
  | { configured: false; reason: string };

type TelegramEnv = Pick<
  WorkerEnv,
  'TELEGRAM_API_ID' | 'TELEGRAM_API_HASH' | 'TELEGRAM_SESSION_DATABASE_URL' | 'TELEGRAM_SESSION_KEY'
>;

/** Telegram is optional: without credentials the worker runs and reports why Telegram is off. */
export function telegramSettingsFrom(env: TelegramEnv): TelegramSettings {
  if (env.TELEGRAM_API_ID === undefined || env.TELEGRAM_API_HASH === undefined) {
    return { configured: false, reason: 'TELEGRAM_API_ID and TELEGRAM_API_HASH are not set' };
  }
  if (!env.TELEGRAM_SESSION_DATABASE_URL) {
    return { configured: false, reason: 'TELEGRAM_SESSION_DATABASE_URL is not set' };
  }
  if (!env.TELEGRAM_SESSION_KEY) {
    return { configured: false, reason: 'TELEGRAM_SESSION_KEY is not set' };
  }
  return {
    configured: true,
    apiId: env.TELEGRAM_API_ID,
    apiHash: env.TELEGRAM_API_HASH,
    sessionDatabaseUrl: env.TELEGRAM_SESSION_DATABASE_URL,
    sessionKey: env.TELEGRAM_SESSION_KEY,
  };
}

const MTCUTE_LOG_LEVELS: Record<LogLevelName, number> = { error: 1, warn: 2, info: 2, debug: 3 };

/** mtcute's info level is chatty (every reconnect); it only follows LOG_LEVEL from warn down. */
export function mtcuteLogLevel(level: LogLevelName): number {
  return MTCUTE_LOG_LEVELS[level];
}
