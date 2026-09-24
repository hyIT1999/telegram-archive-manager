import { Injectable, InjectionToken, computed, effect, inject } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import type { TelegramStatusDto } from '../../shared/models';
import { TelegramApi } from './telegram-api';

export interface TelegramPolling {
  /** Re-read the status this often while the worker or its Telegram connection is not up. */
  readonly statusMs: number;
  /** Re-read the chat list this often while the worker refreshes it. */
  readonly chatsMs: number;
}

export const TELEGRAM_POLLING = new InjectionToken<TelegramPolling>('TELEGRAM_POLLING', {
  providedIn: 'root',
  factory: () => ({ statusMs: 5_000, chatsMs: 2_000 }),
});

/** The worker is down or not connected to Telegram (yet): worth checking again shortly. */
export function isWaitingForWorker(status: TelegramStatusDto): boolean {
  return status.worker === 'offline' || status.connection !== 'CONNECTED';
}

/**
 * The Telegram connection and login state a page shows. Each page that shows it provides its own
 * instance, so the polling stops when the page is left.
 */
@Injectable()
export class TelegramSession {
  private readonly api = inject(TelegramApi);
  private readonly polling = inject(TELEGRAM_POLLING);
  private readonly resource = rxResource({ stream: () => this.api.status() });

  /** The latest status; kept while it is being re-read. */
  readonly status = computed<TelegramStatusDto | undefined>(() =>
    this.resource.hasValue() ? this.resource.value() : undefined,
  );
  readonly error = computed(() => this.resource.error());
  /** Logged in to Telegram. The worker may still be offline: cached chats remain readable. */
  readonly ready = computed(() => this.status()?.state === 'READY');

  constructor() {
    effect((onCleanup) => {
      const status = this.status();
      if (!status || !isWaitingForWorker(status) || this.resource.isLoading()) {
        return;
      }
      const timer = setTimeout(() => this.resource.reload(), this.polling.statusMs);
      onCleanup(() => clearTimeout(timer));
    });
  }

  reload(): void {
    this.resource.reload();
  }

  /** Adopts the state an action answered with (a status read still in flight is dropped). */
  update(status: TelegramStatusDto): void {
    this.resource.set(status);
  }
}
