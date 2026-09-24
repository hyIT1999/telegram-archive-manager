import { z } from 'zod';
import { MediaType } from '../enums.js';
import { cursorQuerySchema, isoDateOrDateTimeSchema } from './common.js';

/** Accepts `a,b,c` (query string) or an array and yields a de-duplicated array. */
function csvList<T extends z.ZodType>(item: T) {
  return z.preprocess((value) => {
    if (typeof value === 'string') {
      return value
        .split(',')
        .map((part) => part.trim())
        .filter((part) => part.length > 0);
    }
    return value;
  }, z.array(item).max(50).transform((items) => [...new Set(items)]));
}

export const messageSortSchema = z.enum(['newest', 'oldest']);
export type MessageSort = z.infer<typeof messageSortSchema>;

export const messageListQuerySchema = cursorQuerySchema.extend({
  channelId: z.uuid().optional(),
  mediaTypes: csvList(z.enum(MediaType)).optional(),
  tagIds: csvList(z.uuid()).optional(),
  favorite: z.stringbool().optional(),
  from: isoDateOrDateTimeSchema.optional(),
  to: isoDateOrDateTimeSchema.optional(),
  sort: messageSortSchema.default('newest'),
  q: z.string().trim().min(1).max(200).optional(),
});
export type MessageListQuery = z.infer<typeof messageListQuerySchema>;
