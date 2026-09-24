import { workerHeartbeatSchema, type HealthReadyDto } from '@tam/shared';

export type WorkerStatus = HealthReadyDto['worker'];

/**
 * The worker stores its heartbeat under REDIS_KEYS.workerHeartbeat with a TTL, so the key vanishes
 * when it stops refreshing it. Alive iff the key exists; lastSeenAt is null when the payload is
 * not a valid heartbeat.
 */
export function workerStatusFromHeartbeat(raw: string | null | undefined): WorkerStatus {
  if (raw === null || raw === undefined) {
    return { status: 'missing', lastSeenAt: null };
  }
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    payload = undefined;
  }
  const heartbeat = workerHeartbeatSchema.safeParse(payload);
  return {
    status: 'alive',
    lastSeenAt: heartbeat.success ? new Date(heartbeat.data.ts).toISOString() : null,
  };
}
