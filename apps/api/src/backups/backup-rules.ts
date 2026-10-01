import type { Prisma } from '@tam/database';
import type { PrismaService } from '@tam/database/nest';
import { BACKUP_SETTINGS_KEY, type BackupSettings, readBackupSettings } from '@tam/shared';

/** The backup settings as stored (app_settings "backups"), with defaults for what is missing. */
export async function loadBackupSettings(
  prisma: PrismaService | Prisma.TransactionClient,
): Promise<BackupSettings> {
  const row = await prisma.appSetting.findUnique({ where: { key: BACKUP_SETTINGS_KEY } });
  return readBackupSettings(row?.value);
}

/**
 * Takes running backups away from the worker (ACTIVE → PENDING): every one, or the ones of some
 * channels that nobody asked for. The worker notices at its next write and stops. A send already
 * under way (stage SENDING) is left alone: its outcome must be recorded, or the message could be
 * posted twice.
 */
export async function stopRunningBackups(
  tx: Prisma.TransactionClient,
  channelIds?: readonly string[],
): Promise<number> {
  return channelIds === undefined
    ? tx.$executeRaw`
        UPDATE message_backups SET status = 'PENDING', stage = NULL, updated_at = now()
        WHERE status = 'ACTIVE' AND stage IS DISTINCT FROM 'SENDING'`
    : tx.$executeRaw`
        UPDATE message_backups SET status = 'PENDING', stage = NULL, updated_at = now()
        WHERE status = 'ACTIVE' AND stage IS DISTINCT FROM 'SENDING' AND requested_at IS NULL
          AND channel_id = ANY(${[...channelIds]}::uuid[])`;
}

/** The channel and the old basic groups it was upgraded from (their messages follow it). */
export async function withOldGroups(
  prisma: PrismaService | Prisma.TransactionClient,
  channelId: string,
): Promise<string[]> {
  const oldGroups = await prisma.channel.findMany({
    where: { migratedToChannelId: channelId },
    select: { id: true },
  });
  return [channelId, ...oldGroups.map((group) => group.id)];
}
