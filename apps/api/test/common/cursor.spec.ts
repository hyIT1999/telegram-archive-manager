import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { decodeCursor, encodeCursor } from '../../src/common/pagination/cursor.js';

const schema = z.tuple([z.iso.datetime(), z.uuid()]);
const values = ['2026-01-10T12:00:00.000Z', '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b'] as const;

describe('keyset cursors', () => {
  it('round-trip the sort key values through an opaque URL-safe string', () => {
    const cursor = encodeCursor(values);
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeCursor(cursor, schema)).toEqual(values);
  });

  it.each([
    ['not base64 json', '!!!'],
    ['valid JSON of the wrong shape', encodeCursor(['yesterday', 'x'])],
    ['a truncated cursor', encodeCursor(values).slice(0, 20)],
  ])('reject %s with 400 INVALID_CURSOR', (_label, cursor) => {
    let failure: unknown;
    try {
      decodeCursor(cursor, schema);
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(BadRequestException);
    expect((failure as BadRequestException).getResponse()).toEqual({
      message: 'Invalid cursor',
      code: 'INVALID_CURSOR',
    });
  });
});
