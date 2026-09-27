import { describe, expect, it } from 'vitest';
import { cappedTotal, TOTAL_COUNT_ROWS } from '../../src/common/pagination/capped-total.js';

describe('cappedTotal', () => {
  it('reports exact counts up to the limit, and the limit with a flag beyond it', () => {
    expect(TOTAL_COUNT_ROWS).toBe(10_001);
    expect(cappedTotal(null)).toEqual({ total: null, totalCapped: false });
    expect(cappedTotal(0)).toEqual({ total: 0, totalCapped: false });
    expect(cappedTotal(10_000)).toEqual({ total: 10_000, totalCapped: false });
    expect(cappedTotal(10_001)).toEqual({ total: 10_000, totalCapped: true });
  });
});
