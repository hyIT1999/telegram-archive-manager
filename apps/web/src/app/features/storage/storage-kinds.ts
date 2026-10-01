import type { StorageKind, TelegramBackupChatDto } from '../../shared/models';
import { chatTypeLabel } from '../channels/channel-labels';

/** Kinds media files are downloaded to. */
export const DOWNLOAD_KINDS: readonly StorageKind[] = ['LOCAL', 'GOOGLE_DRIVE'];

/** Kinds that receive backup copies of messages. */
export const BACKUP_KINDS: readonly StorageKind[] = ['TELEGRAM'];

const KIND_ICONS: Readonly<Record<StorageKind, string>> = {
  LOCAL: 'folder',
  GOOGLE_DRIVE: 'add_to_drive',
  TELEGRAM: 'send',
};

const KIND_LABELS: Readonly<Record<StorageKind, string>> = {
  LOCAL: 'Folder on this computer',
  GOOGLE_DRIVE: 'Google Drive',
  TELEGRAM: 'Telegram chat',
};

export function storageKindIcon(kind: StorageKind): string {
  return KIND_ICONS[kind];
}

export function storageKindLabel(kind: StorageKind): string {
  return KIND_LABELS[kind];
}

/** "Private · Supergroup with topics", "@backups · Channel". */
export function backupChatDescription(chat: TelegramBackupChatDto): string {
  const handle = chat.username ? `@${chat.username}` : 'Private';
  return `${handle} · ${chatTypeLabel(chat.type)}${chat.isForum ? ' with topics' : ''}`;
}
