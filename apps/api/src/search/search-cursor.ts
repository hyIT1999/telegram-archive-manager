import { BadRequestException } from '@nestjs/common';
import { ApiErrorCode, type SearchSort } from '@tam/shared';
import { z } from 'zod';
import { decodeCursor, encodeCursor } from '../common/pagination/cursor.js';
import type { SearchPosition } from './search-provider.js';

const SORT_CODES: Readonly<Record<SearchSort, string>> = {
  relevance: 'r',
  newest: 'n',
  oldest: 'o',
};

/** A real, as PostgreSQL prints it ("0.0607927", "1e-05"). */
const rankSchema = z.string().regex(/^\d+(\.\d+)?(e[+-]?\d+)?$/);

const searchCursorSchema = z.union([
  z
    .tuple([z.literal('r'), rankSchema, z.iso.datetime(), z.number().int(), z.uuid()])
    .transform(([, rank, date, telegramMessageId, id]) => ({
      sort: 'relevance' as SearchSort,
      position: { id, telegramDate: new Date(date), telegramMessageId, rank },
    })),
  z
    .tuple([z.enum(['n', 'o']), z.iso.datetime(), z.number().int(), z.uuid()])
    .transform(([code, date, telegramMessageId, id]) => ({
      sort: (code === 'n' ? 'newest' : 'oldest') as SearchSort,
      position: { id, telegramDate: new Date(date), telegramMessageId, rank: null },
    })),
]);

export function encodeSearchCursor(sort: SearchSort, hit: SearchPosition): string {
  const position = [hit.telegramDate.toISOString(), hit.telegramMessageId, hit.id];
  return encodeCursor(
    sort === 'relevance' ? ['r', hit.rank ?? '0', ...position] : [SORT_CODES[sort], ...position],
  );
}

/** Decodes a cursor of the same order, or throws 400 INVALID_CURSOR. */
export function decodeSearchCursor(cursor: string, sort: SearchSort): SearchPosition {
  const decoded = decodeCursor(cursor, searchCursorSchema);
  if (decoded.sort !== sort) {
    throw new BadRequestException({
      message: 'The cursor belongs to another sort order',
      code: ApiErrorCode.INVALID_CURSOR,
    });
  }
  return decoded.position;
}
