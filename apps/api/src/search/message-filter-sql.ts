import { Prisma } from '@tam/database';
import { GENERAL_TOPIC_ID, type MessageFilters, rangeEnd, rangeStart } from '@tam/shared';

/**
 * The filters of messageWhere() (messages/message-query.ts) as SQL on `messages m`, for queries
 * Prisma cannot build. Both must keep meaning the same; the e2e tests hold them to it.
 */
export function messageFilterSql(
  filters: MessageFilters,
  channelIds: readonly string[] | null,
): Prisma.Sql {
  const parts: Prisma.Sql[] = [];
  if (channelIds !== null) {
    parts.push(Prisma.sql`m.channel_id = ANY(${[...channelIds]}::uuid[])`);
  }
  if (filters.topicId !== undefined) {
    // The General topic's messages carry no thread id.
    parts.push(
      filters.topicId === GENERAL_TOPIC_ID
        ? Prisma.sql`m.thread_id IS NULL`
        : Prisma.sql`m.thread_id = ${filters.topicId}`,
    );
  }
  parts.push(
    filters.types
      ? Prisma.sql`m.type::text = ANY(${[...filters.types]}::text[])`
      : Prisma.sql`m.type <> 'SERVICE'`,
  );
  if (filters.from !== undefined) {
    parts.push(
      Prisma.sql`m.telegram_date >= ${rangeStart(filters.from).toISOString()}::timestamptz`,
    );
  }
  if (filters.to !== undefined) {
    parts.push(Prisma.sql`m.telegram_date <= ${rangeEnd(filters.to).toISOString()}::timestamptz`);
  }
  if (filters.downloaded !== undefined) {
    parts.push(
      filters.downloaded
        ? Prisma.sql`EXISTS (SELECT 1 FROM media d WHERE d.message_id = m.id AND d.download_status = 'DOWNLOADED')`
        : Prisma.sql`EXISTS (SELECT 1 FROM media d WHERE d.message_id = m.id AND d.download_status <> 'DOWNLOADED')`,
    );
  }
  for (const tagId of filters.tagIds ?? []) {
    parts.push(
      Prisma.sql`EXISTS (SELECT 1 FROM message_tags t WHERE t.message_id = m.id AND t.tag_id = ${tagId}::uuid)`,
    );
  }
  if (filters.favorite !== undefined) {
    parts.push(Prisma.sql`m.is_favorite = ${filters.favorite}`);
  }
  return Prisma.join(parts, ' AND ');
}
