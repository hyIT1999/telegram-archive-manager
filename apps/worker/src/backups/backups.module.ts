import { Module } from '@nestjs/common';
import { MediaModule } from '../media/media.module.js';
import { TelegramModule } from '../telegram/telegram.module.js';
import { BackupReconciler } from './backup-reconciler.js';
import { BackupScheduler } from './backup-scheduler.js';
import { BackupSender } from './backup-sender.js';
import {
  BACKUP_OWNER,
  BACKUP_TUNING,
  BackupPolicy,
  backupOwnerToken,
  defaultBackupTuning,
} from './backup-settings.js';
import { BackupSources } from './backup-sources.js';
import { BackupStore } from './backup-store.js';
import { BackupTopics } from './backup-topics.js';
import { BackupVerifier } from './backup-verifier.js';

/**
 * Telegram backups: copies of archived messages sent as new messages to a chat of the account's
 * (message_backups), their scheduler, the reconciler of dead runs, and Verify.
 */
@Module({
  // Downloaded copies are read through the storage drivers; the cached previews are thumbnails.
  imports: [TelegramModule, MediaModule],
  providers: [
    { provide: BACKUP_TUNING, useFactory: defaultBackupTuning },
    { provide: BACKUP_OWNER, useFactory: backupOwnerToken },
    BackupPolicy,
    BackupStore,
    BackupSources,
    BackupTopics,
    BackupSender,
    BackupScheduler,
    BackupReconciler,
    BackupVerifier,
  ],
})
export class BackupsModule {}
