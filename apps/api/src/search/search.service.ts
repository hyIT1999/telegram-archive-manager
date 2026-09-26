import { Injectable } from '@nestjs/common';
import { PrismaService } from '@tam/database/nest';
import type { MessagePageDto, MessageSummaryDto, SearchQuery } from '@tam/shared';
import {
  MESSAGE_SUMMARY_INCLUDE,
  type MessageSummaryRow,
  toMessageSummaryDto,
} from '../messages/message.mapper.js';
import { channelWithOldGroups, topicTitles } from '../messages/message-lookups.js';
import { decodeSearchCursor, encodeSearchCursor } from './search-cursor.js';
import { SearchProvider } from './search-provider.js';
import { excerptAround, findMatches, searchTerms } from './search-text.js';

/**
 * Searches through the configured SearchProvider, then shows the hits like any message list,
 * with the words found marked in the file name and in an excerpt taken around them.
 */
@Injectable()
export class SearchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly provider: SearchProvider,
  ) {}

  async search(query: SearchQuery): Promise<MessagePageDto> {
    const after = query.cursor === undefined ? null : decodeSearchCursor(query.cursor, query.sort);
    const channelIds =
      query.channelId === undefined
        ? null
        : await channelWithOldGroups(this.prisma, query.channelId);
    const terms = searchTerms(query.q);
    const result = await this.provider.search({
      terms,
      filters: query,
      channelIds,
      sort: query.sort,
      after,
      limit: query.limit,
      withTotal: after === null,
    });
    const rows = await this.prisma.message.findMany({
      where: { id: { in: result.hits.map((hit) => hit.id) } },
      include: MESSAGE_SUMMARY_INCLUDE,
    });
    const byId = new Map(rows.map((row) => [row.id, row]));
    // In the provider's order; a message deleted in the meantime just drops out.
    const found = result.hits.flatMap((hit) => byId.get(hit.id) ?? []);
    const titles = await topicTitles(this.prisma, found);
    const last = result.hits.at(-1);
    return {
      items: found.map((row) => withMatches(toMessageSummaryDto(row, titles), row, terms)),
      nextCursor: result.hasMore && last ? encodeSearchCursor(query.sort, last) : null,
      total: result.total,
    };
  }
}

/** Marks the words found; the excerpt moves to the first match when it lies deep in the text. */
function withMatches(
  item: MessageSummaryDto,
  row: MessageSummaryRow,
  terms: readonly string[],
): MessageSummaryDto {
  const text = row.text ?? row.caption;
  const shown = text ? excerptAround(text, terms) : null;
  const fileName = item.media?.fileName ?? null;
  return {
    ...item,
    excerpt: shown ? shown.excerpt : item.excerpt,
    matches: {
      fileName: fileName ? findMatches(fileName, terms) : [],
      excerpt: shown ? shown.matches : [],
    },
  };
}
