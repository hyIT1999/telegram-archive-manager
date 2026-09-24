import { Prisma } from '@tam/database';
import type { PrismaService } from '@tam/database/nest';
import type { ChannelStatsDto } from '@tam/shared';

interface ChannelStatsRow {
  channelId: string;
  messages: number;
  media: number;
  downloadedMedia: number;
  /** numeric sum as text: exact, and never a BigInt/Decimal in JSON. */
  storageBytes: string;
}

/**
 * Message/media counters for a set of channels in one query (no N+1): one lateral subquery per
 * counter family, each served by the (channel_id, …) and (message_id, …) indexes.
 */
export async function loadChannelStats(
  prisma: PrismaService,
  channelIds: readonly string[],
): Promise<Map<string, ChannelStatsDto>> {
  if (channelIds.length === 0) {
    return new Map();
  }
  const ids = Prisma.join(channelIds.map((id) => Prisma.sql`${id}::uuid`));
  const rows = await prisma.$queryRaw<ChannelStatsRow[]>`
    SELECT c.id::text AS "channelId",
           coalesce(msg.total, 0)::int AS "messages",
           coalesce(med.total, 0)::int AS "media",
           coalesce(med.downloaded, 0)::int AS "downloadedMedia",
           coalesce(med.downloaded_bytes, 0)::text AS "storageBytes"
    FROM unnest(ARRAY[${ids}]) AS c(id)
    LEFT JOIN LATERAL (
      SELECT count(*) AS total
      FROM messages m
      WHERE m.channel_id = c.id
    ) msg ON true
    LEFT JOIN LATERAL (
      SELECT count(*) AS total,
             count(*) FILTER (WHERE md.download_status = 'DOWNLOADED') AS downloaded,
             sum(md.size) FILTER (WHERE md.download_status = 'DOWNLOADED') AS downloaded_bytes
      FROM media md
      JOIN messages m ON m.id = md.message_id
      WHERE m.channel_id = c.id
    ) med ON true`;

  return new Map(
    rows.map((row) => [
      row.channelId,
      {
        messages: row.messages,
        media: row.media,
        downloadedMedia: row.downloadedMedia,
        storageBytes: Number(row.storageBytes),
      },
    ]),
  );
}
