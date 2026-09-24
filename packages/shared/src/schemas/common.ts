import { z } from 'zod';

export const idParamSchema = z.object({ id: z.uuid() });
export type IdParam = z.infer<typeof idParamSchema>;

/** Telegram ids (chat ids, message ids) travel as decimal strings — they can exceed 2^53. */
export const telegramIdSchema = z.string().regex(/^-?\d{1,20}$/, 'Must be a numeric Telegram id');

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 100;

export const cursorQuerySchema = z.object({
  cursor: z.string().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});
export type CursorQuery = z.infer<typeof cursorQuerySchema>;

/** A date (YYYY-MM-DD) or an ISO date-time with offset. */
export const isoDateOrDateTimeSchema = z.union([z.iso.date(), z.iso.datetime({ offset: true })]);

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

/** Error body returned by every API endpoint. */
export interface ApiErrorBody {
  statusCode: number;
  error: string;
  message: string;
  /** Stable machine-readable code, e.g. WORKER_UNAVAILABLE, IMPORT_REQUIRED. */
  code?: string;
  details?: unknown;
}
