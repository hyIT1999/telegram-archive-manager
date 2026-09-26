import { DestroyRef, effect, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { EMPTY, type Observable, asyncScheduler, merge, throttleTime } from 'rxjs';
import { LiveEvents } from './live-events';

/**
 * While live, what a view shows still gets read again this often, for what changes without an
 * event (a paused setting, a storage location's free space).
 */
export const LIVE_SAFETY_POLL_MS = 60_000;

export interface LiveRefreshOptions {
  /** Reads the view's data again. */
  reload: () => void;
  /** Live events that concern the view (already filtered); each asks for a reload. */
  events?: Observable<unknown>;
  /** At most one reload this often while events keep coming (the last one always counts). */
  throttleMs?: number;
  /** A read in progress: the next poll waits for its answer. */
  loading: () => boolean;
  /** Whether the view needs updates now (e.g. a job is moving); default always. */
  active?: () => boolean;
  /** How long until the next poll, while live or not; null polls no more. */
  poll: (live: boolean) => number | null;
}

/**
 * Keeps a view current: reloads on its live events (throttled) and after missed updates
 * (LiveEvents.resync$), and polls in between — rarely while live, as before while not.
 * Call it in an injection context (a constructor).
 */
export function liveRefresh(options: LiveRefreshOptions): void {
  const live = inject(LiveEvents);
  const destroyRef = inject(DestroyRef);

  merge(options.events ?? EMPTY, live.resync$)
    .pipe(
      throttleTime(options.throttleMs ?? 0, asyncScheduler, { leading: true, trailing: true }),
      takeUntilDestroyed(destroyRef),
    )
    .subscribe(() => options.reload());

  effect((onCleanup) => {
    if (options.loading() || !(options.active?.() ?? true)) {
      return;
    }
    const delay = options.poll(live.connected());
    if (delay === null) {
      return;
    }
    const timer = setTimeout(() => options.reload(), delay);
    onCleanup(() => clearTimeout(timer));
  });
}
