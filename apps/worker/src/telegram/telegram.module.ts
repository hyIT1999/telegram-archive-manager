import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SecretBox } from '@tam/crypto';
import type { WorkerEnv } from '../config/env.schema.js';
import { ForumTopicsService } from './forum-topics.service.js';
import { TelegramAuthService } from './telegram-auth.service.js';
import { TelegramConnection } from './telegram-connection.js';
import { TelegramCooldown } from './telegram-cooldown.js';
import { TelegramDialogsService } from './telegram-dialogs.service.js';
import { TelegramLifecycle } from './telegram-lifecycle.js';
import { TelegramRedisConnection } from './telegram-redis.connection.js';
import { TelegramRpcServer } from './telegram-rpc.server.js';
import { type TelegramSettings, telegramSettingsFrom } from './telegram-settings.js';
import { TelegramUpdates } from './telegram-updates.js';
import {
  SECRET_BOX,
  TELEGRAM_API_PROVIDER,
  TELEGRAM_REDIS,
  TELEGRAM_SETTINGS,
} from './telegram.tokens.js';

@Module({
  providers: [
    {
      provide: TELEGRAM_SETTINGS,
      inject: [ConfigService],
      useFactory: (config: ConfigService<WorkerEnv, true>): TelegramSettings =>
        telegramSettingsFrom({
          TELEGRAM_API_ID: config.get('TELEGRAM_API_ID', { infer: true }),
          TELEGRAM_API_HASH: config.get('TELEGRAM_API_HASH', { infer: true }),
          TELEGRAM_SESSION_DATABASE_URL: config.get('TELEGRAM_SESSION_DATABASE_URL', {
            infer: true,
          }),
          TELEGRAM_SESSION_KEY: config.get('TELEGRAM_SESSION_KEY', { infer: true }),
        }),
    },
    {
      provide: SECRET_BOX,
      inject: [TELEGRAM_SETTINGS],
      useFactory: (settings: TelegramSettings): SecretBox | null =>
        settings.configured ? SecretBox.fromBase64(settings.sessionKey) : null,
    },
    TelegramRedisConnection,
    {
      provide: TELEGRAM_REDIS,
      inject: [TelegramRedisConnection],
      useFactory: (connection: TelegramRedisConnection) => connection.client,
    },
    { provide: TelegramCooldown, useFactory: () => new TelegramCooldown() },
    TelegramUpdates,
    TelegramConnection,
    { provide: TELEGRAM_API_PROVIDER, useExisting: TelegramConnection },
    TelegramAuthService,
    TelegramDialogsService,
    ForumTopicsService,
    TelegramRpcServer,
    TelegramLifecycle,
  ],
  // Imports, downloads, syncs and topic refreshes use the same connection, check the login state
  // first and respect Telegram's waits.
  exports: [
    TELEGRAM_API_PROVIDER,
    TelegramAuthService,
    TelegramCooldown,
    ForumTopicsService,
    TelegramUpdates,
    // Backups answer their own requests (backup.verify) through it.
    TelegramRpcServer,
    TelegramDialogsService,
    TELEGRAM_REDIS,
  ],
})
export class TelegramModule {}
