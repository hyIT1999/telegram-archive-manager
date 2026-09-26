import type { Provider } from '@angular/core';
import {
  LIVE_EVENT_SOURCE,
  LIVE_TIMINGS,
  type LiveEventSource,
  type LiveTimings,
} from '../app/core/live/live-events';
import type { LiveEvent } from '../app/shared/models';

const CONNECTING = 0;
const OPEN = 1;
const CLOSED = 2;

/** A scripted stand-in for the browser's EventSource. */
export class FakeEventSource implements LiveEventSource {
  readyState = CONNECTING;
  onmessage: ((message: MessageEvent<string>) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  closed = false;

  constructor(readonly url: string) {}

  /** The server sends an event. */
  send(event: LiveEvent): void {
    this.readyState = OPEN;
    this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(event) }));
  }

  /** The connection dropped; the browser will reconnect by itself. */
  drop(): void {
    this.readyState = CONNECTING;
    this.onerror?.(new Event('error'));
  }

  /** The server refused the stream (401, 502…): the browser gives up. */
  refuse(): void {
    this.readyState = CLOSED;
    this.onerror?.(new Event('error'));
  }

  close(): void {
    this.readyState = CLOSED;
    this.closed = true;
  }
}

/** Every stream the app opened, the latest last. */
export class FakeEventSources {
  readonly opened: FakeEventSource[] = [];

  get latest(): FakeEventSource {
    const source = this.opened.at(-1);
    if (!source) {
      throw new Error('No live updates stream was opened');
    }
    return source;
  }

  /** Opens-and-readies the latest stream, as the api does right after connecting. */
  ready(): FakeEventSource {
    const source = this.latest;
    source.send({ type: 'ready' });
    return source;
  }
}

/**
 * Providers that make the app's live updates scriptable: every stream is a FakeEventSource in
 * `sources`, and the waits are short.
 */
export function provideFakeLiveEvents(
  sources = new FakeEventSources(),
  timings: Partial<LiveTimings> = {},
): Provider[] {
  return [
    {
      provide: LIVE_EVENT_SOURCE,
      useValue: (url: string) => {
        const source = new FakeEventSource(url);
        sources.opened.push(source);
        return source;
      },
    },
    {
      provide: LIVE_TIMINGS,
      useValue: {
        retryMs: 20,
        maxRetryMs: 80,
        hiddenCloseMs: 50,
        stalledAfterMs: 50,
        silenceMs: 5_000,
        ...timings,
      } satisfies LiveTimings,
    },
  ];
}
