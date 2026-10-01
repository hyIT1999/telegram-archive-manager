import { Prisma } from './generated/prisma/client.js';

export interface SeedMessageBackupsOptions {
  /** The channel and its old basic groups. */
  channelIds: readonly string[];
  /** The backup chat (a storage location of kind TELEGRAM). */
  storageLocationId: string;
  /** Only these messages ("Back up now"); every message of the channels otherwise. */
  messageIds?: readonly string[];
}

/**
 * Creates the missing backup rows of the channels' messages for one backup chat and returns how
 * many it created. Existing rows are left alone (ON CONFLICT DO NOTHING), so it runs as often as
 * needed: when backup is switched on, for "Back up now", and in the worker for new messages.
 * Service messages get no row. Polls and other kinds that cannot be recreated start SKIPPED, and
 * so does a media message whose file was never archived (self-destructing media).
 */
export async function seedMessageBackups(
  tx: Prisma.TransactionClient,
  options: SeedMessageBackupsOptions,
): Promise<number> {
  if (options.channelIds.length === 0) {
    return 0;
  }
  const onlyMessages = options.messageIds
    ? Prisma.sql`AND m.id = ANY(${[...options.messageIds]}::uuid[])`
    : Prisma.empty;
  return tx.$executeRaw`
    INSERT INTO message_backups (message_id, storage_location_id, channel_id, status, skip_reason, size)
    SELECT m.id, ${options.storageLocationId}::uuid, m.channel_id,
           (CASE WHEN s.reason IS NULL THEN 'PENDING' ELSE 'SKIPPED' END)::"BackupStatus",
           s.reason::"BackupSkipReason",
           md.size
    FROM messages m
    LEFT JOIN media md ON md.message_id = m.id
    CROSS JOIN LATERAL (
      SELECT CASE
        WHEN m.type IN ('POLL', 'OTHER') THEN 'UNSUPPORTED'
        WHEN m.type NOT IN ('TEXT', 'WEBPAGE') AND md.id IS NULL THEN 'NOT_AVAILABLE'
      END AS reason
    ) s
    WHERE m.channel_id = ANY(${[...options.channelIds]}::uuid[])
      AND m.type <> 'SERVICE'
      ${onlyMessages}
    ON CONFLICT (message_id, storage_location_id) DO NOTHING`;
}
