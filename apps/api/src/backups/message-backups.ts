import type { MessageBackup, StorageLocation } from '@tam/database';
import type { PrismaService } from '@tam/database/nest';
import { BackupStatus, type MessageBackupDto, telegramMessageUrl } from '@tam/shared';
import { locationConfig } from '@tam/storage';

/** The link to a copy, for people who can read the backup chat. */
function copyUrl(backup: MessageBackup, location: StorageLocation): string | null {
  if (backup.status !== BackupStatus.COMPLETED || backup.backupMessageId === null) {
    return null;
  }
  const config = locationConfig(location);
  if (config.kind !== 'TELEGRAM') {
    return null;
  }
  return telegramMessageUrl(
    { type: config.type, username: config.username, telegramChatId: config.chatId },
    backup.backupMessageId,
  );
}

export function toMessageBackupDto(
  backup: MessageBackup,
  location: StorageLocation,
): MessageBackupDto {
  return {
    chat: { id: location.id, name: location.name, displayPath: location.displayPath },
    status: backup.status,
    stage: backup.stage,
    skipReason: backup.skipReason,
    error: backup.error,
    attempts: backup.attempts,
    size: backup.size === null ? null : Number(backup.size),
    uploadedBytes: Number(backup.uploadedBytes),
    requested: backup.requestedAt !== null && backup.status !== BackupStatus.COMPLETED,
    url: copyUrl(backup, location),
    completedAt: backup.completedAt?.toISOString() ?? null,
    verifiedAt: backup.verifiedAt?.toISOString() ?? null,
    verifyError: backup.verifyError,
  };
}

/** The copies of one message, oldest backup chat first. */
export async function loadMessageBackups(
  prisma: PrismaService,
  messageId: string,
): Promise<MessageBackupDto[]> {
  const rows = await prisma.messageBackup.findMany({
    where: { messageId },
    include: { storageLocation: true },
    orderBy: { createdAt: 'asc' },
  });
  return rows.map((row) => toMessageBackupDto(row, row.storageLocation));
}
