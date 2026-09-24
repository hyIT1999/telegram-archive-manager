import { platform, release } from 'node:os';
import type { ITelegramStorageProvider } from '@mtcute/core';
import { TelegramClient, networkMiddlewares } from '@mtcute/node';

/** Shown to the user under Settings → Devices in the official Telegram apps. */
export const DEVICE_MODEL = 'Unofficial Telegram Archive Manager';

export interface MtcuteClientOptions {
  apiId: number;
  apiHash: string;
  storage: ITelegramStorageProvider;
  appVersion: string;
  /** mtcute log level: 0 off, 1 error, 2 warn, 3 info, 4 debug. */
  logLevel?: number;
  /** Called before mtcute sleeps through a short FLOOD_WAIT (≤ 10 s); longer ones are thrown. */
  onFloodWait?: (method: string, seconds: number) => void;
}

export function createMtcuteClient(options: MtcuteClientOptions): TelegramClient {
  return new TelegramClient({
    apiId: options.apiId,
    apiHash: options.apiHash,
    storage: options.storage,
    // Realtime updates are not consumed before Phase 7 (sync).
    updates: false,
    logLevel: options.logLevel ?? 2,
    initConnectionOptions: {
      deviceModel: DEVICE_MODEL,
      appVersion: options.appVersion,
      systemVersion: `${platform()} ${release()}`,
    },
    network: {
      middlewares: networkMiddlewares.basic({
        floodWaiter: {
          maxWait: 10_000,
          onBeforeWait: (context, seconds) => options.onFloodWait?.(context.request._, seconds),
        },
      }),
    },
  });
}
