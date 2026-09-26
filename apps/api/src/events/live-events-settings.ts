/** LiveEventsSettings for the live updates stream (tests shorten them). */
export const LIVE_EVENTS_SETTINGS = Symbol('LIVE_EVENTS_SETTINGS');

export interface LiveEventsSettings {
  /** Changes arriving within this window go out together (a page of history is one change). */
  batchMs: number;
  /** Jobs sent in full per window; beyond that, clients are asked to read again instead. */
  maxJobsPerBatch: number;
  /** A `ping` this often keeps quiet connections (and proxies in between) open. */
  heartbeatMs: number;
  /** How often an open stream checks that its session still exists. */
  sessionCheckMs: number;
  /** How long a browser waits before it reconnects (the SSE `retry` field). */
  retryMs: number;
}

export const DEFAULT_LIVE_EVENTS_SETTINGS: LiveEventsSettings = {
  batchMs: 250,
  maxJobsPerBatch: 50,
  heartbeatMs: 25_000,
  sessionCheckMs: 60_000,
  retryMs: 5_000,
};
