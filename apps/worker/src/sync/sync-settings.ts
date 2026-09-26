import type { Prisma } from '@tam/database';

/** SyncSchedulerSettings for the sync scheduler and the new messages listener. */
export const SYNC_SCHEDULER_SETTINGS = Symbol('SYNC_SCHEDULER_SETTINGS');

export interface SyncSchedulerSettings {
  /** How often the scheduler runs a round; null = never on its own (tests call syncDue()). */
  tickMs: number | null;
  /** Channels checked with Telegram per round (one small history request each). */
  checkBatch: number;
  /** A channel Telegram announced new messages for is synced at most this often. */
  updateGapMs: number;
  /** After a sync failed, the channel is synced again automatically no sooner than this. */
  failedSyncBackoffMs: number;
  /** A channel whose check failed (an unexpected error) waits this long before the next one. */
  checkBackoffMs: number;
  /** Syncs that started on their own are forgotten this long after they ended. */
  keepSyncJobsMs: number;
  /** The listener re-reads which chats sync at most this often. */
  syncedChatsMaxAgeMs: number;
}

export const DEFAULT_SYNC_SCHEDULER_SETTINGS: SyncSchedulerSettings = {
  tickMs: 15_000,
  checkBatch: 10,
  updateGapMs: 60_000,
  failedSyncBackoffMs: 6 * 3_600_000,
  checkBackoffMs: 30 * 60_000,
  keepSyncJobsMs: 30 * 24 * 3_600_000,
  syncedChatsMaxAgeMs: 60_000,
};

/**
 * Channels that sync: switched on, not protected, and not the frozen old basic group of an
 * upgraded supergroup.
 */
export const SYNCED_CHANNEL = {
  syncEnabled: true,
  isProtected: false,
  migratedToChannelId: null,
} satisfies Prisma.ChannelWhereInput;
