import { HttpClient, HttpContext, HttpErrorResponse } from '@angular/common/http';
import { DOCUMENT, Injectable, InjectionToken, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { type Observable, Subject, filter } from 'rxjs';
import type { LiveEvent, LiveEventOf, LiveEventType } from '../../shared/models';
import { AUTH_ENDPOINTS, AuthService } from '../auth/auth-service';
import { sessionExpired } from '../auth/session-expired';
import { ERRORS_SHOWN_INLINE } from '../interceptors/server-error-interceptor';

/** The live updates stream of the api (server-sent events). */
export const LIVE_EVENTS_URL = '/api/events';

/** What LiveEvents needs of an EventSource: the browser's own, or a fake in tests. */
export interface LiveEventSource {
  readonly readyState: number;
  onmessage: ((message: MessageEvent<string>) => void) | null;
  onerror: ((event: Event) => void) | null;
  close(): void;
}

/** Opens the stream; null where the browser has no EventSource (pages then poll). */
export const LIVE_EVENT_SOURCE = new InjectionToken<(url: string) => LiveEventSource | null>(
  'LIVE_EVENT_SOURCE',
  {
    providedIn: 'root',
    factory: () => (url) => (typeof EventSource === 'undefined' ? null : new EventSource(url)),
  },
);

export interface LiveTimings {
  /** First wait before reopening a stream the server refused; doubled up to `maxRetryMs`. */
  readonly retryMs: number;
  readonly maxRetryMs: number;
  /** A tab hidden this long closes its stream: browsers allow few connections per site. */
  readonly hiddenCloseMs: number;
  /** Reconnecting this long, the header says that pages are not live. */
  readonly stalledAfterMs: number;
  /**
   * Nothing received this long (the api pings every 25 s) means the stream died without closing
   * (a proxy can hold a dead connection open): it is opened again.
   */
  readonly silenceMs: number;
}

export const LIVE_TIMINGS = new InjectionToken<LiveTimings>('LIVE_TIMINGS', {
  providedIn: 'root',
  factory: () => ({
    retryMs: 2_000,
    maxRetryMs: 30_000,
    hiddenCloseMs: 30_000,
    stalledAfterMs: 10_000,
    silenceMs: 60_000,
  }),
});

/** EventSource.CLOSED: the browser gave up on the stream and will not reconnect by itself. */
const CLOSED = 2;

export type LiveStatus =
  /** Not receiving: signed out, or the tab has been hidden a while. */
  | 'off'
  /** Opening, or reconnecting after the connection dropped. */
  | 'connecting'
  /** Changes arrive as they are made. */
  | 'live'
  /** This browser cannot receive them; pages poll instead. */
  | 'unavailable';

/**
 * The live updates of the api for the whole tab: one stream, opened while the signed-in layout
 * is shown. Pages subscribe to the events they show and read again on `resync$`, after updates
 * may have been missed. While not live, pages fall back to polling (see liveRefresh).
 */
@Injectable({ providedIn: 'root' })
export class LiveEvents {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly document = inject(DOCUMENT);
  private readonly openSource = inject(LIVE_EVENT_SOURCE);
  private readonly timings = inject(LIVE_TIMINGS);

  private readonly state = signal<LiveStatus>('off');
  readonly status = this.state.asReadonly();
  /** Changes arrive as they are made; pages poll while this is false. */
  readonly connected = computed(() => this.state() === 'live');
  private readonly stalledState = signal(false);
  /** Reconnecting for a while: what pages show may lag behind. */
  readonly stalled = this.stalledState.asReadonly();

  private readonly events = new Subject<LiveEvent>();
  private readonly resyncs = new Subject<void>();
  /** Updates may have been missed: pages read again what they show. */
  readonly resync$: Observable<void> = this.resyncs.asObservable();

  private source: LiveEventSource | null = null;
  private users = 0;
  /** A stream was live before: the next `ready` means a reconnect, after which pages resync. */
  private wasLive = false;
  private closedWhileHidden = false;
  private retryMs: number;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private hiddenTimer: ReturnType<typeof setTimeout> | undefined;
  private stalledTimer: ReturnType<typeof setTimeout> | undefined;
  private silenceTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    this.retryMs = this.timings.retryMs;
  }

  /** Events of one type. */
  on<T extends LiveEventType>(type: T): Observable<LiveEventOf<T>> {
    return this.events.pipe(filter((event): event is LiveEventOf<T> => event.type === type));
  }

  /** Receives updates until the returned function is called. */
  connect(): () => void {
    this.users += 1;
    if (this.users === 1) {
      this.document.addEventListener('visibilitychange', this.visibilityChanged);
      this.open();
    }
    let connected = true;
    return () => {
      if (!connected) {
        return;
      }
      connected = false;
      this.users -= 1;
      if (this.users === 0) {
        this.document.removeEventListener('visibilitychange', this.visibilityChanged);
        this.stop();
        this.wasLive = false;
      }
    };
  }

  private open(): void {
    this.closeSource();
    const source = this.openSource(LIVE_EVENTS_URL);
    if (!source) {
      this.setState('unavailable');
      return;
    }
    this.source = source;
    this.setState('connecting');
    source.onmessage = (message) => this.received(source, message.data);
    source.onerror = () => this.failed(source);
    this.expectNews(source);
  }

  /** Opens the stream again if nothing arrives in time: it died without closing. */
  private expectNews(source: LiveEventSource): void {
    clearTimeout(this.silenceTimer);
    this.silenceTimer = setTimeout(() => {
      if (source === this.source) {
        this.open();
      }
    }, this.timings.silenceMs);
  }

  private received(source: LiveEventSource, data: string): void {
    if (source !== this.source) {
      return;
    }
    this.expectNews(source);
    let event: LiveEvent;
    try {
      event = JSON.parse(data) as LiveEvent;
    } catch {
      return;
    }
    switch (event.type) {
      case 'ready':
        this.retryMs = this.timings.retryMs;
        this.setState('live');
        if (this.wasLive) {
          this.resyncs.next();
        }
        this.wasLive = true;
        return;
      case 'ping':
        return;
      case 'resync':
        this.resyncs.next();
        return;
      case 'session.ended':
        this.stop();
        sessionExpired(this.auth, this.router);
        return;
      default:
        this.events.next(event);
    }
  }

  private failed(source: LiveEventSource): void {
    if (source !== this.source) {
      return;
    }
    this.setState('connecting');
    if (source.readyState !== CLOSED) {
      // The connection dropped: the browser reconnects by itself.
      return;
    }
    // Refused (signed out, server down…): is the session still there?
    this.closeSource();
    this.http
      .get(AUTH_ENDPOINTS.me, { context: new HttpContext().set(ERRORS_SHOWN_INLINE, true) })
      .subscribe({
        next: () => this.openLater(),
        error: (error: unknown) => {
          if (error instanceof HttpErrorResponse && error.status === 401) {
            this.stop();
            sessionExpired(this.auth, this.router);
          } else {
            this.openLater();
          }
        },
      });
  }

  private openLater(): void {
    if (this.users === 0 || this.closedWhileHidden) {
      return;
    }
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => this.open(), this.retryMs);
    this.retryMs = Math.min(this.retryMs * 2, this.timings.maxRetryMs);
  }

  private readonly visibilityChanged = (): void => {
    clearTimeout(this.hiddenTimer);
    if (this.document.visibilityState === 'hidden') {
      this.hiddenTimer = setTimeout(() => {
        this.closedWhileHidden = true;
        clearTimeout(this.retryTimer);
        this.closeSource();
        this.setState('off');
      }, this.timings.hiddenCloseMs);
    } else if (this.closedWhileHidden) {
      this.closedWhileHidden = false;
      this.open();
    }
  };

  private setState(state: LiveStatus): void {
    const previous = this.state();
    this.state.set(state);
    if (state !== 'connecting') {
      clearTimeout(this.stalledTimer);
      this.stalledState.set(false);
    } else if (previous !== 'connecting') {
      // Counted from the first failed attempt, not from each of the browser's retries.
      this.stalledTimer = setTimeout(
        () => this.stalledState.set(true),
        this.timings.stalledAfterMs,
      );
    }
  }

  private stop(): void {
    clearTimeout(this.retryTimer);
    clearTimeout(this.hiddenTimer);
    this.closedWhileHidden = false;
    this.closeSource();
    this.setState('off');
  }

  private closeSource(): void {
    clearTimeout(this.silenceTimer);
    const source = this.source;
    this.source = null;
    if (source) {
      source.onmessage = null;
      source.onerror = null;
      source.close();
    }
  }
}
