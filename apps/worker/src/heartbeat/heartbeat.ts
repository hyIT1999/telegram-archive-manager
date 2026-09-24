import type { WorkerHeartbeat } from '@tam/shared';

// The payload contract and its TTL live in @tam/shared (the api parses the same shape).
export { HEARTBEAT_TTL_FACTOR, heartbeatTtlMs, type WorkerHeartbeat } from '@tam/shared';

export function buildHeartbeat(fields: {
  now: Date;
  startedAt: Date;
  pid: number;
  host: string;
}): WorkerHeartbeat {
  return {
    ts: fields.now.toISOString(),
    pid: fields.pid,
    host: fields.host,
    startedAt: fields.startedAt.toISOString(),
  };
}
