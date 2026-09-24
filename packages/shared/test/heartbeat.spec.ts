import { describe, expect, it } from 'vitest';
import { HEARTBEAT_TTL_FACTOR, heartbeatTtlMs, workerHeartbeatSchema } from '../src/index.js';

describe('worker heartbeat contract', () => {
  it('accepts the payload the worker writes', () => {
    const beat = {
      ts: '2026-09-24T02:00:05.000Z',
      pid: 4242,
      host: 'tam-worker',
      startedAt: '2026-09-24T02:00:00.000Z',
    };
    expect(workerHeartbeatSchema.parse(beat)).toEqual(beat);
    expect(workerHeartbeatSchema.safeParse({ ...beat, ts: 'yesterday' }).success).toBe(false);
  });

  it('keeps the key alive for three intervals', () => {
    expect(HEARTBEAT_TTL_FACTOR).toBe(3);
    expect(heartbeatTtlMs(5_000)).toBe(15_000);
  });
});
