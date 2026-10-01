import type {
  BackupSkipReason,
  BackupStage,
  BackupStatus,
  MessageBackupDto,
} from '../../shared/models';

export const BACKUP_STAGE_LABELS: Readonly<Record<BackupStage, string>> = {
  FETCHING: 'Reading the message',
  UPLOADING: 'Uploading to Telegram',
  SENDING: 'Sending the copy',
};

export const BACKUP_SKIP_LABELS: Readonly<Record<BackupSkipReason, string>> = {
  NOT_AVAILABLE: 'Deleted on Telegram, and never downloaded',
  PROTECTED: 'Content protection is on',
  UNSUPPORTED: 'This kind of message cannot be recreated',
  TOO_LARGE: 'Larger than Telegram accepts from this account',
};

const STATUS_ICONS: Readonly<Record<BackupStatus, string>> = {
  PENDING: 'schedule',
  ACTIVE: 'cloud_upload',
  COMPLETED: 'cloud_done',
  FAILED: 'error',
  SKIPPED: 'block',
};

export function backupStatusIcon(status: BackupStatus): string {
  return STATUS_ICONS[status];
}

/** "Backed up", "Uploading to Telegram", "Waiting (asked for)", "Failed", "Skipped: …". */
export function backupStatusText(backup: MessageBackupDto): string {
  switch (backup.status) {
    case 'PENDING':
      return backup.requested ? 'Waiting, first in line' : 'Waiting';
    case 'ACTIVE':
      return backup.stage ? BACKUP_STAGE_LABELS[backup.stage] : 'Starting';
    case 'COMPLETED':
      return 'Backed up';
    case 'FAILED':
      return 'Failed';
    case 'SKIPPED':
      return backup.skipReason
        ? `Not backed up: ${BACKUP_SKIP_LABELS[backup.skipReason]}`
        : 'Not backed up';
  }
}

/** What the message page offers for a backup: to send it now, again, or nothing while it runs. */
export type BackupAction = 'now' | 'again' | null;

export function backupAction(backup: MessageBackupDto | null): BackupAction {
  if (backup === null) {
    return 'now';
  }
  switch (backup.status) {
    case 'PENDING':
      return backup.requested ? null : 'now';
    case 'ACTIVE':
      return null;
    case 'FAILED':
      return 'now';
    case 'COMPLETED':
    case 'SKIPPED':
      return 'again';
  }
}
