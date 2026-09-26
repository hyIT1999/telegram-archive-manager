import type { SyncIntervalMinutes } from '../../shared/models';

/** The check intervals the api accepts (SYNC_INTERVAL_MINUTES), as Settings offers them. */
export const SYNC_INTERVAL_OPTIONS: readonly { minutes: SyncIntervalMinutes; label: string }[] = [
  { minutes: 15, label: 'Every 15 minutes' },
  { minutes: 30, label: 'Every 30 minutes' },
  { minutes: 60, label: 'Every hour' },
  { minutes: 180, label: 'Every 3 hours' },
  { minutes: 360, label: 'Every 6 hours' },
  { minutes: 720, label: 'Every 12 hours' },
  { minutes: 1440, label: 'Once a day' },
];
