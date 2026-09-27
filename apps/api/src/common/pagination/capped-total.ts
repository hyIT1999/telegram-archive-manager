import { MESSAGE_TOTAL_LIMIT } from '@tam/shared';

/** How many rows a total counts at most: one more than the limit tells "more than the limit". */
export const TOTAL_COUNT_ROWS = MESSAGE_TOTAL_LIMIT + 1;

/** A count of at most TOTAL_COUNT_ROWS rows, as a page reports it (null: not counted). */
export function cappedTotal(counted: number | null): {
  total: number | null;
  totalCapped: boolean;
} {
  if (counted === null) {
    return { total: null, totalCapped: false };
  }
  return {
    total: Math.min(counted, MESSAGE_TOTAL_LIMIT),
    totalCapped: counted > MESSAGE_TOTAL_LIMIT,
  };
}
