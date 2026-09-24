import type { WorkerEnv } from '../config/env.schema.js';

/** ImportSettings, derived from the environment (tests pass their own). */
export const IMPORT_SETTINGS = Symbol('IMPORT_SETTINGS');

export interface ImportSettings {
  /** Pause between two pages of history, to stay clear of Telegram's rate limits. */
  pageDelayMs: number;
  /** How long a run waits before trying again while Telegram is not available. */
  unavailableRetryMs: number;
  /** How often the reconciler compares import_jobs with the queue. */
  reconcileIntervalMs: number;
}

export const UNAVAILABLE_RETRY_MS = 30_000;
export const RECONCILE_INTERVAL_MS = 60_000;

export function importSettingsFrom(env: Pick<WorkerEnv, 'IMPORT_PAGE_DELAY_MS'>): ImportSettings {
  return {
    pageDelayMs: env.IMPORT_PAGE_DELAY_MS,
    unavailableRetryMs: UNAVAILABLE_RETRY_MS,
    reconcileIntervalMs: RECONCILE_INTERVAL_MS,
  };
}
