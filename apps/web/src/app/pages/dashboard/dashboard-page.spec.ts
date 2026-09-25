import { type HttpRequest, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { STATS_KEYS } from '@tam/shared';
import {
  failNetwork,
  flushError,
  makeMessage,
  makeMessagePage,
  makeStats,
} from '../../../testing/fixtures';
import { MemoryStorage } from '../../../testing/memory-storage';
import { STAT_GROUPS } from '../../features/dashboard/stat-definitions';
import { PLAYBACK_STORAGE } from '../../features/media/playback-memory';
import { NETWORK_ERROR_MESSAGE } from '../../shared/models';
import { DashboardPage, LATEST_MEDIA_COUNT } from './dashboard-page';

describe('DashboardPage', () => {
  let fixture: ComponentFixture<DashboardPage>;
  let http: HttpTestingController;
  let storage: MemoryStorage;

  const isLatest = (request: HttpRequest<unknown>) => request.url === '/api/messages';

  function setup(): void {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: PLAYBACK_STORAGE, useValue: storage },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(DashboardPage);
    // Let the resources start their requests; awaiting stability now would wait for the answers.
    TestBed.tick();
  }

  /** Answers the "Latest media" request (nothing by default). */
  function answerLatest(items = [] as ReturnType<typeof makeMessage>[]): void {
    http.expectOne(isLatest).flush(makeMessagePage(items));
  }

  beforeEach(() => {
    storage = new MemoryStorage();
  });

  afterEach(() => http.verify());

  const element = () => fixture.nativeElement as HTMLElement;
  const statCard = (key: string) => element().querySelector(`app-stat-card[data-stat="${key}"]`);

  it('covers every StatsDto field exactly once', () => {
    setup();
    const keys = STAT_GROUPS.flatMap((group) => group.stats.map((stat) => stat.key));
    expect([...keys].sort()).toEqual([...STATS_KEYS].sort());
    http.expectOne('/api/stats').flush(makeStats());
    answerLatest();
  });

  it('shows skeletons while GET /api/stats is pending', () => {
    setup();
    const request = http.expectOne('/api/stats');
    expect(request.request.method).toBe('GET');
    expect(element().querySelector('app-skeleton')).not.toBeNull();
    expect(element().querySelectorAll('app-stat-card')).toHaveLength(0);
    request.flush(makeStats());
    answerLatest();
  });

  it('renders the ten statistics from the API', async () => {
    setup();
    http
      .expectOne('/api/stats')
      .flush(
        makeStats({ channels: 4, messages: 12_345, storageBytes: 1536 * 1024 ** 2, failed: 2 }),
      );
    answerLatest();
    await fixture.whenStable();

    expect(element().querySelector('app-skeleton')).toBeNull();
    expect(element().querySelectorAll('app-stat-card')).toHaveLength(10);
    expect(statCard('channels')?.textContent).toContain('Channels');
    expect(statCard('channels')?.textContent).toContain('4');
    expect(statCard('messages')?.textContent).toContain('12,345');
    expect(statCard('storageBytes')?.textContent).toContain('1.5 GiB');
    expect(statCard('failed')?.textContent).toContain('2');
    expect(statCard('videos')?.querySelector('a')?.getAttribute('href')).toBe('/videos');
    expect(element().textContent).not.toContain('Your archive is empty');
    // Nothing started in this browser, and no media yet: neither shelf shows.
    expect(element().textContent).not.toContain('Continue watching');
    expect(element().textContent).not.toContain('Latest media');
  });

  it('points to Import Jobs when the archive is empty', async () => {
    setup();
    http.expectOne('/api/stats').flush(
      makeStats({
        channels: 0,
        messages: 0,
        videos: 0,
        images: 0,
        documents: 0,
        audio: 0,
        storageBytes: 0,
        downloaded: 0,
        pending: 0,
        failed: 0,
      }),
    );
    answerLatest();
    await fixture.whenStable();

    expect(element().textContent).toContain('Your archive is empty');
    const importLink = Array.from(element().querySelectorAll('a')).find((link) =>
      link.textContent?.includes('Go to Import Jobs'),
    );
    expect(importLink?.getAttribute('href')).toBe('/imports');
    expect(statCard('storageBytes')?.textContent).toContain('0 B');
  });

  it('shows an error state and recovers on retry', async () => {
    setup();
    failNetwork(http.expectOne('/api/stats'));
    answerLatest();
    await fixture.whenStable();

    const errorState = element().querySelector('app-error-state');
    expect(errorState?.textContent).toContain('The dashboard could not be loaded');
    expect(errorState?.textContent).toContain(NETWORK_ERROR_MESSAGE);

    errorState?.querySelector('button')?.click();
    TestBed.tick();
    http.expectOne('/api/stats').flush(makeStats());
    await fixture.whenStable();

    expect(element().querySelector('app-error-state')).toBeNull();
    expect(element().querySelectorAll('app-stat-card')).toHaveLength(10);
  });

  it('shows server errors in the error state', async () => {
    setup();
    flushError(http.expectOne('/api/stats'), 500, 'boom');
    answerLatest();
    await fixture.whenStable();

    expect(element().querySelector('app-error-state')).not.toBeNull();
    expect(element().querySelectorAll('app-stat-card')).toHaveLength(0);
  });

  it('shows the latest media files of the archive', async () => {
    setup();
    http.expectOne('/api/stats').flush(makeStats());
    const request = http.expectOne(isLatest);
    expect(request.request.params.get('limit')).toBe(String(LATEST_MEDIA_COUNT));
    expect(request.request.params.get('types')?.split(',')).toEqual(
      expect.arrayContaining(['VIDEO', 'PHOTO', 'DOCUMENT', 'AUDIO']),
    );
    const video = makeMessage();
    request.flush(makeMessagePage([video, makeMessage()]));
    await fixture.whenStable();

    const tiles = element().querySelectorAll('app-media-tile');
    expect(element().textContent).toContain('Latest media');
    expect(tiles).toHaveLength(2);
    expect(tiles[0]?.querySelector('a')?.getAttribute('href')).toBe(`/messages/${video.id}`);
  });

  it('offers to continue what was left half-watched in this browser', async () => {
    storage.setItem(
      'tam.player.progress',
      JSON.stringify([
        {
          mediaId: 'media-1',
          messageId: 'message-1',
          title: 'Lesson 3 — lenses',
          kind: 'video',
          position: 300,
          duration: 1200,
          updatedAt: 2,
        },
        // Finished files are not offered.
        {
          mediaId: 'media-2',
          messageId: 'message-2',
          title: 'Lesson 2',
          kind: 'video',
          position: 1195,
          duration: 1200,
          updatedAt: 1,
        },
      ]),
    );
    setup();
    http.expectOne('/api/stats').flush(makeStats());
    answerLatest();
    await fixture.whenStable();

    const shelf = element().querySelector('[aria-labelledby="continue-title"]');
    expect(shelf?.textContent).toContain('Continue watching');
    const entries = shelf?.querySelectorAll('li') ?? [];
    expect(entries).toHaveLength(1);
    expect(entries[0]?.textContent).toContain('Lesson 3 — lenses');
    expect(entries[0]?.textContent).toContain('15:00 left');
    expect(entries[0]?.querySelector('a')?.getAttribute('href')).toBe('/messages/message-1');
  });
});
