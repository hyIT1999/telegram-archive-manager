import { describe, expect, it } from 'vitest';
import { workerStatusFromHeartbeat } from '../../src/health/worker-heartbeat.js';

describe('workerStatusFromHeartbeat', () => {
  it('reports a missing worker when the heartbeat key has expired', () => {
    expect(workerStatusFromHeartbeat(null)).toEqual({ status: 'missing', lastSeenAt: null });
  });

  it('reports the heartbeat time of a live worker', () => {
    const raw = JSON.stringify({
      ts: '2026-09-24T01:02:03.456Z',
      pid: 4242,
      host: 'srv-1',
      startedAt: '2026-09-24T01:00:00.000Z',
    });
    expect(workerStatusFromHeartbeat(raw)).toEqual({
      status: 'alive',
      lastSeenAt: '2026-09-24T01:02:03.456Z',
    });
  });

  it('normalizes timestamps with an offset to UTC', () => {
    const raw = JSON.stringify({
      ts: '2026-09-24T08:02:03+07:00',
      pid: 1,
      host: 'srv-1',
      startedAt: '2026-09-24T08:00:00+07:00',
    });
    expect(workerStatusFromHeartbeat(raw).lastSeenAt).toBe('2026-09-24T01:02:03.000Z');
  });

  it('still counts an unreadable heartbeat as alive (the key only exists while the worker runs)', () => {
    expect(workerStatusFromHeartbeat('not json')).toEqual({ status: 'alive', lastSeenAt: null });
    expect(workerStatusFromHeartbeat(JSON.stringify({ ts: 'yesterday' }))).toEqual({
      status: 'alive',
      lastSeenAt: null,
    });
  });
});
