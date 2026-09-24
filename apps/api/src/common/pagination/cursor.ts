import { BadRequestException } from '@nestjs/common';
import { ApiErrorCode } from '@tam/shared';
import type { z } from 'zod';

/**
 * Opaque keyset cursors: the sort-key values of the last row of a page, as base64url JSON.
 * Clients must treat them as opaque strings; the server validates them on the way back in.
 */
export function encodeCursor(values: readonly (string | number)[]): string {
  return Buffer.from(JSON.stringify(values), 'utf8').toString('base64url');
}

/** Decodes a cursor produced by encodeCursor, or throws 400 INVALID_CURSOR. */
export function decodeCursor<T>(cursor: string, schema: z.ZodType<T>): T {
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    decoded = undefined;
  }
  const parsed = schema.safeParse(decoded);
  if (!parsed.success) {
    throw new BadRequestException({ message: 'Invalid cursor', code: ApiErrorCode.INVALID_CURSOR });
  }
  return parsed.data;
}
