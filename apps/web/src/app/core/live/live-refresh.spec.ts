import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Subject } from 'rxjs';
import { FakeEventSources, provideFakeLiveEvents } from '../../../testing/live';
import { LiveEvents } from './live-events';
import { liveRefresh } from './live-refresh';

/** What a view feeds liveRefresh, scripted by the tests. */
const events = new Subject<string>();
const loading = signal(false);
const active = signal(true);
let polls = { live: null as number | null, offline: null as number | null };
let reloads = 0;

@Component({ template: '' })
class ViewStub {
  constructor() {
    liveRefresh({
      reload: () => {
        reloads += 1;
      },
      events,
      throttleMs: 40,
      loading,
      active,
      poll: (live) => (live ? polls.live : polls.offline),
    });
  }
}

describe('liveRefresh', () => {
  let sources: FakeEventSources;

  beforeEach(() => {
    sources = new FakeEventSources();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        ...provideFakeLiveEvents(sources),
      ],
    });
    reloads = 0;
    loading.set(false);
    active.set(true);
    polls = { live: null, offline: null };
  });

  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  it('reloads on the first event at once and once more after a burst', async () => {
    TestBed.createComponent(ViewStub);
    events.next('a');
    expect(reloads).toBe(1);
    events.next('b');
    events.next('c');
    expect(reloads).toBe(1);
    await vi.waitFor(() => expect(reloads).toBe(2));
    await wait(60);
    expect(reloads).toBe(2);
  });

  it('reloads after missed updates', async () => {
    TestBed.inject(LiveEvents).connect();
    TestBed.createComponent(ViewStub);
    sources.ready();
    sources.latest.drop();
    sources.latest.send({ type: 'ready' });
    expect(reloads).toBe(1);
  });

  it('polls while not live, rarely while live, and not while inactive or loading', async () => {
    polls = { live: null, offline: 20 };
    const fixture = TestBed.createComponent(ViewStub);
    await vi.waitFor(() => expect(reloads).toBeGreaterThanOrEqual(1));

    // A reload is on its way: the next poll waits for its answer.
    loading.set(true);
    fixture.detectChanges();
    const counted = reloads;
    await wait(60);
    expect(reloads).toBe(counted);

    loading.set(false);
    active.set(false);
    fixture.detectChanges();
    await wait(60);
    expect(reloads).toBe(counted);

    // Live: the offline poll stops.
    active.set(true);
    TestBed.inject(LiveEvents).connect();
    sources.ready();
    fixture.detectChanges();
    await wait(60);
    expect(reloads).toBe(counted);
  });
});
