import { z } from 'zod';
import { MediaType } from '../enums.js';
import { csvList, cursorQuerySchema, isoDateOrDateTimeSchema } from './common.js';

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
