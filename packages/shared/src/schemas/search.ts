import { z } from 'zod';
import { cursorQuerySchema } from './common.js';
import { messageFilterShape, withFilterRules } from './messages.js';

/** Characters a search may be. */
export const SEARCH_QUERY_MAX_LENGTH = 200;
/** Words a search looks for; the rest of a long query is left out. */
export const SEARCH_MAX_TERMS = 8;

/** `relevance`: best matches first. */
export const searchSortSchema = z.enum(['relevance', 'newest', 'oldest']);
export type SearchSort = z.infer<typeof searchSortSchema>;

/** A search needs something to match: a letter or a digit. */
const SEARCHABLE = /[\p{L}\p{N}]/u;

/**
 * GET /api/search — message text, captions and file names, without accents, every word as the
 * start of a word. Takes the filters of GET /api/messages.
 */
export const searchQuerySchema = withFilterRules(
  cursorQuerySchema.extend({
    ...messageFilterShape,
    q: z
      .string()
      .trim()
      .min(1, 'Type something to search for')
      .max(SEARCH_QUERY_MAX_LENGTH)
      .refine((q) => SEARCHABLE.test(q), 'Type at least one letter or digit'),
    sort: searchSortSchema.default('relevance'),
  }),
);
export type SearchQuery = z.infer<typeof searchQuerySchema>;
