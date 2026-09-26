import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { flushError, makeImportJob, makeUser } from '../../../testing/fixtures';
import { nextRequest } from '../../../testing/http';
import { FakeEventSources, provideFakeLiveEvents } from '../../../testing/live';
import type { LiveEvent } from '../../shared/models';
import { AUTH_ENDPOINTS } from '../auth/auth-service';
import { LIVE_EVENT_SOURCE, LIVE_EVENTS_URL, LiveEvents, type LiveTimings } from './live-events';

@Component({ template: 'page' })
class PageStub {}

describe('LiveEvents', () => {
  let sources: FakeEventSources;
  let http: HttpTestingController;

  function setup(extra: unknown[] = [], timings: Partial<LiveTimings> = {}) {
    sources = new FakeEventSources();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'login', component: PageStub },
          { path: 'imports', component: PageStub },
        ]),
        provideHttpClient(),
        provideHttpClientTesting(),
        ...provideFakeLiveEvents(sources, timings),
        ...(extra as never[]),
      ],
    });
    http = TestBed.inject(HttpTestingController);
    return TestBed.inject(LiveEvents);
  }

  afterEach(() => http.verify());

  it('opens one stream while in use and closes it when the last user leaves', () => {
    const live = setup();
    expect(live.status()).toBe('off');
    const first = live.connect();
    const second = live.connect();
    expect(sources.opened).toHaveLength(1);
    expect(sources.latest.url).toBe(LIVE_EVENTS_URL);
    expect(live.status()).toBe('connecting');

    first();
    first();
    expect(sources.latest.closed).toBe(false);
    second();
    expect(sources.latest.closed).toBe(true);
    expect(live.status()).toBe('off');
  });

  it('is live once ready, hands out events by type, and resyncs after a reconnect', () => {
    const live = setup();
    const jobs: LiveEvent[] = [];
    const hints: LiveEvent[] = [];
    let resyncs = 0;
    live.on('import.job').subscribe((event) => jobs.push(event));
    live.on('downloads.changed').subscribe((event) => hints.push(event));
    live.resync$.subscribe(() => (resyncs += 1));
    live.connect();

    const source = sources.ready();
    expect(live.connected()).toBe(true);
    expect(resyncs).toBe(0);
    const job = makeImportJob();
    source.send({ type: 'import.job', job });
    source.send({ type: 'downloads.changed', channelId: job.channelId });
    expect(jobs).toEqual([{ type: 'import.job', job }]);
    expect(hints).toEqual([{ type: 'downloads.changed', channelId: job.channelId }]);

    // The connection drops and the browser reconnects: what came meanwhile was missed.
    source.drop();
    expect(live.status()).toBe('connecting');
    source.send({ type: 'ready' });
    expect(resyncs).toBe(1);
    source.send({ type: 'resync' });
    expect(resyncs).toBe(2);
  });

  it('leaves pages to poll where the browser cannot receive updates', () => {
    const live = setup([{ provide: LIVE_EVENT_SOURCE, useValue: () => null }]);
    live.connect();
    expect(live.status()).toBe('unavailable');
    expect(live.connected()).toBe(false);
  });

  it('goes to the login page when a refused stream turns out to have lost its session', async () => {
    const live = setup();
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/imports');
    live.connect();
    sources.ready();

    sources.latest.refuse();
    expect(sources.latest.closed).toBe(true);
    flushError(await nextRequest(http, AUTH_ENDPOINTS.me), 401, 'Authentication required');
    await vi.waitFor(() => expect(router.url).toBe('/login?returnUrl=%2Fimports'));
    expect(live.status()).toBe('off');
    expect(sources.opened).toHaveLength(1);
  });

  it('reopens a refused stream later while the session holds', async () => {
    const live = setup();
    live.connect();
    sources.latest.refuse();
    (await nextRequest(http, AUTH_ENDPOINTS.me)).flush(makeUser());
    await vi.waitFor(() => expect(sources.opened).toHaveLength(2));
    sources.ready();
    expect(live.connected()).toBe(true);

    // The server is down: the session check fails too, and the next try waits longer.
    sources.latest.refuse();
    flushError(await nextRequest(http, AUTH_ENDPOINTS.me), 502, 'Bad Gateway');
    await vi.waitFor(() => expect(sources.opened).toHaveLength(3));
  });

  it('goes to the login page when the api ends the session', async () => {
    const live = setup();
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/imports');
    live.connect();
    sources.ready();
    sources.latest.send({ type: 'session.ended' });
    expect(sources.latest.closed).toBe(true);
    await vi.waitFor(() => expect(router.url).toBe('/login?returnUrl=%2Fimports'));
  });

  it('closes while the tab is hidden, and catches up when it is shown again', async () => {
    const live = setup();
    let resyncs = 0;
    live.resync$.subscribe(() => (resyncs += 1));
    live.connect();
    sources.ready();

    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.waitFor(() => expect(sources.latest.closed).toBe(true));
    expect(live.status()).toBe('off');

    visibility.mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(sources.opened).toHaveLength(2);
    sources.ready();
    expect(resyncs).toBe(1);
    visibility.mockRestore();
  });

  it('says so when reconnecting takes a while', async () => {
    const live = setup();
    live.connect();
    sources.ready();
    sources.latest.drop();
    expect(live.stalled()).toBe(false);
    // The browser's own retries do not restart the count.
    sources.latest.drop();
    await vi.waitFor(() => expect(live.stalled()).toBe(true));
    sources.latest.send({ type: 'ready' });
    expect(live.stalled()).toBe(false);
  });
  it('opens a stream that went silent again, while pings keep a quiet one open', async () => {
    const live = setup([], { silenceMs: 80 });
    let resyncs = 0;
    live.resync$.subscribe(() => (resyncs += 1));
    live.connect();
    sources.ready();
    for (let beat = 0; beat < 4; beat += 1) {
      await new Promise((resolve) => setTimeout(resolve, 40));
      sources.latest.send({ type: 'ping' });
    }
    expect(sources.opened).toHaveLength(1);
    expect(live.connected()).toBe(true);

    // A proxy keeps the dead connection open: nothing arrives any more.
    await vi.waitFor(() => expect(sources.opened).toHaveLength(2));
    expect(sources.opened[0]?.closed).toBe(true);
    expect(live.status()).toBe('connecting');
    sources.ready();
    expect(resyncs).toBe(1);
  });
});
