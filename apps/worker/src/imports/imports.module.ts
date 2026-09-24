import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { WorkerEnv } from '../config/env.schema.js';
import { TelegramModule } from '../telegram/telegram.module.js';
import { ArchiveWriter } from './archive-writer.js';
import { IMPORT_SETTINGS, importSettingsFrom } from './import-settings.js';
import { ImportReconciler } from './import-reconciler.js';
import { ImportRunner } from './import-runner.js';
import { ImportProcessor } from './import.processor.js';

/** History imports: the telegram-import processor, its runner and the reconciler. */
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
    ImportReconciler,
  ],
})
export class ImportsModule {}
