import { Injectable, InjectionToken, inject } from '@angular/core';

/** Volume, mute and speed, the same for every video and audio file. */
export interface PlayerPreferences {
  readonly volume: number;
  readonly muted: boolean;
  readonly rate: number;
}

/** Where someone stopped watching or listening to a file. */
export interface WatchEntry {
  readonly mediaId: string;
  readonly messageId: string;
  readonly title: string;
  readonly kind: 'video' | 'audio';
  /** Seconds. */
  readonly position: number;
  readonly duration: number;
  /** Date.now() of the last update. */
  readonly updatedAt: number;
}

export const DEFAULT_PREFERENCES: PlayerPreferences = { volume: 1, muted: false, rate: 1 };
/** Files played for less than this (seconds) start over. */
export const RESUME_AFTER_S = 5;
/** Files stopped this close to their end (seconds) count as finished. */
export const FINISHED_WITHIN_S = 15;

const PREFERENCES_KEY = 'tam.player.preferences';
const PROGRESS_KEY = 'tam.player.progress';
const MAX_ENTRIES = 50;

/** The browser storage the player remembers things in; null where there is none. */
export const PLAYBACK_STORAGE = new InjectionToken<Storage | null>('PLAYBACK_STORAGE', {
  providedIn: 'root',
  factory: () => {
    try {
      return globalThis.localStorage ?? null;
    } catch {
      return null;
    }
  },
});

function isEntry(value: unknown): value is WatchEntry {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const entry = value as Record<string, unknown>;
  return (
    typeof entry['mediaId'] === 'string' &&
    typeof entry['messageId'] === 'string' &&
    typeof entry['title'] === 'string' &&
    (entry['kind'] === 'video' || entry['kind'] === 'audio') &&
    typeof entry['position'] === 'number' &&
    typeof entry['duration'] === 'number' &&
    typeof entry['updatedAt'] === 'number'
  );
}

/**
 * Remembers, in this browser only, the player settings and where each video or audio file was
 * left — so a long lesson resumes where it stopped, and the dashboard can offer to continue.
 * Storage may be missing or full (private windows): then nothing is remembered.
 */
@Injectable({ providedIn: 'root' })
export class PlaybackMemory {
  private readonly storage = inject(PLAYBACK_STORAGE);

  preferences(): PlayerPreferences {
    const stored = this.read(PREFERENCES_KEY);
    if (typeof stored !== 'object' || stored === null) {
      return DEFAULT_PREFERENCES;
    }
    const value = stored as Record<string, unknown>;
    const volume = Number(value['volume']);
    const rate = Number(value['rate']);
    return {
      volume: Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : 1,
      muted: value['muted'] === true,
      rate: Number.isFinite(rate) && rate >= 0.25 && rate <= 4 ? rate : 1,
    };
  }

  savePreferences(preferences: PlayerPreferences): void {
    this.write(PREFERENCES_KEY, preferences);
  }

  /** Where to resume the file, or null to start from the beginning. */
  position(mediaId: string): number | null {
    const entry = this.entries().find((candidate) => candidate.mediaId === mediaId);
    return entry && inProgress(entry) ? entry.position : null;
  }

  /** Records where the file stands now; a finished file is forgotten. */
  remember(entry: Omit<WatchEntry, 'updatedAt'>, now = Date.now()): void {
    const others = this.entries().filter((candidate) => candidate.mediaId !== entry.mediaId);
    const next = { ...entry, updatedAt: now };
    const kept = inProgress(next) ? [next, ...others] : others;
    this.write(PROGRESS_KEY, kept.slice(0, MAX_ENTRIES));
  }

  forget(mediaId: string): void {
    this.write(
      PROGRESS_KEY,
      this.entries().filter((candidate) => candidate.mediaId !== mediaId),
    );
  }

  /** Files started and not finished, most recent first. */
  continueWatching(limit = 4): WatchEntry[] {
    return this.entries()
      .filter(inProgress)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, limit);
  }

  private entries(): WatchEntry[] {
    const stored = this.read(PROGRESS_KEY);
    return Array.isArray(stored) ? stored.filter(isEntry) : [];
  }

  private read(key: string): unknown {
    try {
      const raw = this.storage?.getItem(key);
      return raw ? (JSON.parse(raw) as unknown) : null;
    } catch {
      return null;
    }
  }

  private write(key: string, value: unknown): void {
    try {
      this.storage?.setItem(key, JSON.stringify(value));
    } catch {
      // Full or blocked storage: the player simply does not remember.
    }
  }
}

function inProgress(entry: Pick<WatchEntry, 'position' | 'duration'>): boolean {
  return (
    entry.position >= RESUME_AFTER_S &&
    entry.duration > 0 &&
    entry.position < entry.duration - FINISHED_WITHIN_S
  );
}
