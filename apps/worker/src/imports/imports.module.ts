import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { WorkerEnv } from '../config/env.schema.js';
import { TelegramModule } from '../telegram/telegram.module.js';
import { ArchiveWriter } from './archive-writer.js';
import { IMPORT_SETTINGS, importSettingsFrom } from './import-settings.js';
import { ImportReconciler } from './import-reconciler.js';
import { ImportRunner } from './import-runner.js';
import { ImportProcessor, SyncProcessor } from './import.processor.js';

/**
 * History imports and syncs: the telegram-import and telegram-sync processors, their runner and
 * the reconciler.
 */
@Module({
  imports: [TelegramModule],
  providers: [
    {
      provide: IMPORT_SETTINGS,
      inject: [ConfigService],
      useFactory: (config: ConfigService<WorkerEnv, true>) =>
        importSettingsFrom({
          IMPORT_PAGE_DELAY_MS: config.get('IMPORT_PAGE_DELAY_MS', { infer: true }),
        }),
    },
    ArchiveWriter,
    ImportRunner,
    ImportProcessor,
    SyncProcessor,
    ImportReconciler,
  ],
})
export class ImportsModule {}
