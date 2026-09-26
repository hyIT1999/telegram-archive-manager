import {
  DEFAULT_SYNC_SCHEDULER_SETTINGS,
  type SyncSchedulerSettings,
} from '../../../src/sync/sync-settings.js';

/** The sync scheduler never starts a round by itself: syncs run only when a test queues them. */
export const IDLE_SYNC_SETTINGS: SyncSchedulerSettings = {
  ...DEFAULT_SYNC_SCHEDULER_SETTINGS,
  tickMs: null,
};
