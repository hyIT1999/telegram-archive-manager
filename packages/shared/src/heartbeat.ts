import { z } from 'zod';
import { TelegramConnectionState } from './schemas/telegram.js';

/**
 * Value the worker stores as JSON under REDIS_KEYS.workerHeartbeat, with a TTL of
 * HEARTBEAT_TTL_FACTOR × its interval. The api reads it to report worker liveness and the state
 * of the worker's Telegram connection.
 */
export const workerHeartbeatSchema = z.object({
  /** When this beat was written (ISO 8601). */
  ts: z.iso.datetime({ offset: true }),
  pid: z.number().int(),
  host: z.string(),
  /** When this worker instance came up (ISO 8601). */
  startedAt: z.iso.datetime({ offset: true }),
  telegram: z
    .object({
      state: z.enum(TelegramConnectionState),
      /** Short operator-facing explanation, never a secret. */
      detail: z.string().nullable(),
    })
    .optional(),
});
export type WorkerHeartbeat = z.infer<typeof workerHeartbeatSchema>;

/** The key survives two missed beats and expires after the third. */
export const HEARTBEAT_TTL_FACTOR = 3;

export function heartbeatTtlMs(intervalMs: number): number {
  return intervalMs * HEARTBEAT_TTL_FACTOR;
}
