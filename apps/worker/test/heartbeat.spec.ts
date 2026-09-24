import { describe, expect, it } from 'vitest';
import {
  buildHeartbeat,
  HEARTBEAT_TTL_FACTOR,
  heartbeatTtlMs,
} from '../src/heartbeat/heartbeat.js';

describe('heartbeatTtlMs', () => {
  it('keeps the key for three intervals', () => {
    expect(HEARTBEAT_TTL_FACTOR).toBe(3);
    expect(heartbeatTtlMs(5_000)).toBe(15_000);
    expect(heartbeatTtlMs(1_000)).toBe(3_000);
  });

  it('outlives two missed beats but not three', () => {
    const intervalMs = 5_000;
    expect(heartbeatTtlMs(intervalMs)).toBeGreaterThan(2 * intervalMs);
    expect(heartbeatTtlMs(intervalMs)).toBeLessThanOrEqual(3 * intervalMs);
  });
});

describe('buildHeartbeat', () => {
  it('produces the JSON document stored under the heartbeat key', () => {
    const beat = buildHeartbeat({
      now: new Date('2026-09-24T10:00:05.000Z'),
      startedAt: new Date('2026-09-24T10:00:00.000Z'),
      pid: 4242,
      host: 'worker-1',
    });

    expect(JSON.parse(JSON.stringify(beat))).toEqual({
      ts: '2026-09-24T10:00:05.000Z',
      pid: 4242,
      host: 'worker-1',
      startedAt: '2026-09-24T10:00:00.000Z',
    });
  });
});
