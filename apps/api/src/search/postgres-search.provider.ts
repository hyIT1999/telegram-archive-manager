import { Injectable } from '@nestjs/common';
import { Prisma } from '@tam/database';
import { PrismaService } from '@tam/database/nest';
import type { SearchSort } from '@tam/shared';
import { TOTAL_COUNT_ROWS } from '../common/pagination/capped-total.js';
import { messageFilterSql } from './message-filter-sql.js';
import {
  type SearchPosition,
  SearchProvider,
  type SearchRequest,
  type SearchResult,
} from './search-provider.js';
import { exactQuery, phraseQuery, prefixQuery } from './search-text.js';

interface HitRow {
  id: string;
  telegramDate: Date;
  telegramMessageId: number;
  rank: string;
}

const ORDER: Readonly<Record<SearchSort, Prisma.Sql>> = {
  relevance: Prisma.sql`hit.rank DESC, hit.telegram_date DESC, hit.telegram_message_id DESC, hit.id DESC`,
  newest: Prisma.sql`hit.telegram_date DESC, hit.telegram_message_id DESC, hit.id DESC`,
  oldest: Prisma.sql`hit.telegram_date ASC, hit.telegram_message_id ASC, hit.id ASC`,
};

/** Date orders need no rank. */
const RANKLESS = Prisma.sql`0::real`;

/**
 * Matches of word starts, plus whole words, plus the words in the order typed; each divided by the
 * length of the document (flag 1), so that "Buổi 10.mp4" leads a search for "buoi 10" ahead of
 * long names that merely contain both words.
 */
function relevance(terms: readonly string[], prefix: Prisma.Sql): Prisma.Sql {
  const exact = Prisma.sql`to_tsquery('public.tam_simple', ${exactQuery(terms)})`;
  const phrase = Prisma.sql`to_tsquery('public.tam_simple', ${phraseQuery(terms)})`;
  return Prisma.sql`ts_rank(m.search_vector, ${prefix}, 1) + ts_rank(m.search_vector, ${exact}, 1) + ts_rank(m.search_vector, ${phrase}, 1)`;
}

/** The hits after `after` in the order (row comparison follows the ORDER BY above). */
function keyset(sort: SearchSort, after: SearchPosition | null): Prisma.Sql {
  if (after === null) {
    return Prisma.sql`TRUE`;
  }
  const date = Prisma.sql`${after.telegramDate.toISOString()}::timestamptz`;
  const id = Prisma.sql`${after.id}::uuid`;
  switch (sort) {
    case 'relevance':
      return Prisma.sql`(hit.rank, hit.telegram_date, hit.telegram_message_id, hit.id) < (${after.rank ?? '0'}::real, ${date}, ${after.telegramMessageId}, ${id})`;
    case 'newest':
      return Prisma.sql`(hit.telegram_date, hit.telegram_message_id, hit.id) < (${date}, ${after.telegramMessageId}, ${id})`;
    case 'oldest':
      return Prisma.sql`(hit.telegram_date, hit.telegram_message_id, hit.id) > (${date}, ${after.telegramMessageId}, ${id})`;
  }
}

/**
 * PostgreSQL full-text search over messages.search_vector (text, caption and file names, kept by
 * triggers). Every word must match the start of a word, without accents (the `tam_simple`
 * configuration); see relevance() for the order of the best matches.
 */
@Injectable()
export class PostgresSearchProvider extends SearchProvider {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async search(request: SearchRequest): Promise<SearchResult> {
    if (request.terms.length === 0) {
      return { hits: [], hasMore: false, total: request.withTotal ? 0 : null };
    }
    const prefix = Prisma.sql`to_tsquery('public.tam_simple', ${prefixQuery(request.terms)})`;
    const rank = request.sort === 'relevance' ? relevance(request.terms, prefix) : RANKLESS;
    const filters = messageFilterSql(request.filters, request.channelIds);
    const [rows, total] = await Promise.all([
      this.prisma.$queryRaw<HitRow[]>`
        SELECT hit.id::text AS id, hit.telegram_date AS "telegramDate",
               hit.telegram_message_id AS "telegramMessageId", hit.rank::text AS rank
        FROM (
          SELECT m.id, m.telegram_date, m.telegram_message_id, ${rank} AS rank
          FROM messages m
          WHERE m.search_vector @@ ${prefix} AND ${filters}
        ) AS hit
        WHERE ${keyset(request.sort, request.after)}
        ORDER BY ${ORDER[request.sort]}
        LIMIT ${request.limit + 1}`,
      request.withTotal
        ? this.prisma.$queryRaw<{ count: number }[]>`
            SELECT count(*)::int AS count FROM (
              SELECT 1 FROM messages m
              WHERE m.search_vector @@ ${prefix} AND ${filters}
              LIMIT ${TOTAL_COUNT_ROWS}
            ) AS counted`
        : null,
    ]);
    const hasMore = rows.length > request.limit;
    return {
      hits: rows.slice(0, request.limit).map((row) => ({
        id: row.id,
        telegramDate: row.telegramDate,
        telegramMessageId: row.telegramMessageId,
        rank: request.sort === 'relevance' ? row.rank : null,
      })),
      hasMore,
      total: total === null ? null : (total[0]?.count ?? 0),
    };
  }
}
