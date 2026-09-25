import { Injectable } from '@angular/core';
import type { MessageSummaryDto } from '../../shared/models';

/** A feed as it was left: everything loaded so far and where to continue. */
export interface FeedSnapshot {
  readonly items: readonly MessageSummaryDto[];
  readonly nextCursor: string | null;
  readonly total: number | null;
}

/** Feeds kept for Back navigation. */
const MAX_FEEDS = 8;
/** Older snapshots are loaded again instead. */
const MAX_AGE_MS = 10 * 60_000;

/**
 * Remembers the last few feeds in memory, so going Back to a long list shows it at once (at the
 * same scroll position) instead of loading its first page again.
 */
@Injectable({ providedIn: 'root' })
export class FeedStateCache {
  private readonly feeds = new Map<string, { snapshot: FeedSnapshot; savedAt: number }>();

  get(key: string, now = Date.now()): FeedSnapshot | null {
    const entry = this.feeds.get(key);
    if (!entry) {
      return null;
    }
    if (now - entry.savedAt > MAX_AGE_MS) {
      this.feeds.delete(key);
      return null;
    }
    return entry.snapshot;
  }

  set(key: string, snapshot: FeedSnapshot, now = Date.now()): void {
    // Re-inserted, so the Map's order is least recently saved first.
    this.feeds.delete(key);
    this.feeds.set(key, { snapshot, savedAt: now });
    while (this.feeds.size > MAX_FEEDS) {
      const oldest = this.feeds.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      this.feeds.delete(oldest);
    }
  }

  delete(key: string): void {
    this.feeds.delete(key);
  }
}
