import { Injectable } from '@nestjs/common';

/** Space one download needs somewhere. */
export interface SpaceNeed {
  /** What shares the space: a storage location or a staging folder. */
  key: string;
  /** Free bytes the backend reports; null means unlimited or unknown, which never refuses. */
  freeBytes: number | null;
  /** Bytes the file still needs there. */
  bytes: number;
  /** What must stay free after every running download took its share. */
  keepFree: number;
}

export interface SpaceReservation {
  release(): void;
}

export interface SpaceShortage {
  need: SpaceNeed;
  /** What is left for this file once running downloads and the minimum are taken off. */
  available: number;
}

export function isShortage(value: SpaceReservation | SpaceShortage): value is SpaceShortage {
  return 'need' in value;
}

/**
 * Keeps downloads from filling a disk (or a Drive): the bytes a running download still needs are
 * set aside, so parallel downloads never count the same free space twice. Only this worker
 * downloads (a single instance), so memory is enough.
 */
@Injectable()
export class SpaceGuard {
  private readonly reserved = new Map<string, number>();

  /** Sets aside every need at once, or nothing: then the first need that does not fit. */
  reserve(needs: readonly SpaceNeed[]): SpaceReservation | SpaceShortage {
    for (const need of needs) {
      if (need.freeBytes === null) {
        continue;
      }
      const available = need.freeBytes - (this.reserved.get(need.key) ?? 0) - need.keepFree;
      if (need.bytes > available) {
        return { need, available: Math.max(0, available) };
      }
    }
    for (const need of needs) {
      this.reserved.set(need.key, (this.reserved.get(need.key) ?? 0) + need.bytes);
    }
    let released = false;
    return {
      release: () => {
        if (released) {
          return;
        }
        released = true;
        for (const need of needs) {
          const left = (this.reserved.get(need.key) ?? 0) - need.bytes;
          if (left > 0) {
            this.reserved.set(need.key, left);
          } else {
            this.reserved.delete(need.key);
          }
        }
      },
    };
  }
}
