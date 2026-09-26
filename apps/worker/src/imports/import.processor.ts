import { Processor } from '@nestjs/bullmq';
import { Inject } from '@nestjs/common';
import { QUEUES } from '@tam/shared';
import { TelegramAuthService } from '../telegram/telegram-auth.service.js';
import { MAX_STALLED, ImportRunHost } from './import-run-host.js';
import { IMPORT_SETTINGS, type ImportSettings } from './import-settings.js';
import { ImportRunner } from './import-runner.js';

export { WAITING_DETAILS, isFinalFailure } from './import-run-host.js';

/**
 * Runs import jobs one at a time (a single Telegram account; parallel reads only trigger rate
 * limits).
 */
@Processor(QUEUES.telegramImport, { concurrency: 1, maxStalledCount: MAX_STALLED })
export class ImportProcessor extends ImportRunHost {
  constructor(
    runner: ImportRunner,
    auth: TelegramAuthService,
    @Inject(IMPORT_SETTINGS) settings: ImportSettings,
  ) {
    super(runner, auth, settings, 'import');
  }
}

/**
 * Runs sync jobs one at a time, next to at most one import: a sync reads a page or two of new
 * messages, so it should not wait until a long import is done.
 */
@Processor(QUEUES.telegramSync, { concurrency: 1, maxStalledCount: MAX_STALLED })
export class SyncProcessor extends ImportRunHost {
  constructor(
    runner: ImportRunner,
    auth: TelegramAuthService,
    @Inject(IMPORT_SETTINGS) settings: ImportSettings,
  ) {
    super(runner, auth, settings, 'sync');
  }
}
