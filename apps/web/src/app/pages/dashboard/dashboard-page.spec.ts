import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { STATS_KEYS } from '@tam/shared';
import { failNetwork, flushError, makeStats } from '../../../testing/fixtures';
import { STAT_GROUPS } from '../../features/dashboard/stat-definitions';
import { NETWORK_ERROR_MESSAGE } from '../../shared/models';
import { DashboardPage } from './dashboard-page';

describe('DashboardPage', () => {
  let fixture: ComponentFixture<DashboardPage>;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(DashboardPage);
    // Let the resource start its request; awaiting stability now would wait for the response.
    TestBed.tick();
  });

  afterEach(() => http.verify());

  const element = () => fixture.nativeElement as HTMLElement;
  const statCard = (key: string) => element().querySelector(`app-stat-card[data-stat="${key}"]`);

  it('covers every StatsDto field exactly once', () => {
    const keys = STAT_GROUPS.flatMap((group) => group.stats.map((stat) => stat.key));
    expect([...keys].sort()).toEqual([...STATS_KEYS].sort());
    http.expectOne('/api/stats').flush(makeStats());
  });

  it('shows skeletons while GET /api/stats is pending', () => {
    const request = http.expectOne('/api/stats');
    expect(request.request.method).toBe('GET');
    expect(element().querySelector('app-skeleton')).not.toBeNull();
    expect(element().querySelectorAll('app-stat-card')).toHaveLength(0);
    request.flush(makeStats());
  });

  it('renders the ten statistics from the API', async () => {
    http
      .expectOne('/api/stats')
      .flush(
        makeStats({ channels: 4, messages: 12_345, storageBytes: 1536 * 1024 ** 2, failed: 2 }),
      );
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
  });

  it('points to Import Jobs when the archive is empty', async () => {
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
    await fixture.whenStable();

    expect(element().textContent).toContain('Your archive is empty');
    const importLink = Array.from(element().querySelectorAll('a')).find((link) =>
      link.textContent?.includes('Go to Import Jobs'),
    );
    expect(importLink?.getAttribute('href')).toBe('/imports');
    expect(statCard('storageBytes')?.textContent).toContain('0 B');
  });

  it('shows an error state and recovers on retry', async () => {
    failNetwork(http.expectOne('/api/stats'));
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
    flushError(http.expectOne('/api/stats'), 500, 'boom');
    await fixture.whenStable();

    expect(element().querySelector('app-error-state')).not.toBeNull();
    expect(element().querySelectorAll('app-stat-card')).toHaveLength(0);
  });
});
