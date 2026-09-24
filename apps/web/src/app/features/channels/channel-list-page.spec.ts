import { type HttpRequest, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { provideRouter } from '@angular/router';
import { flushError, makeChannel, makePage } from '../../../testing/fixtures';
import { CHANNEL_PAGE_SIZE, ChannelListPage } from './channel-list-page';

describe('ChannelListPage', () => {
  let fixture: ComponentFixture<ChannelListPage>;
  let http: HttpTestingController;

  const isChannelsRequest = (cursor?: string) => (request: HttpRequest<unknown>) =>
    request.url === '/api/channels' && (request.params.get('cursor') ?? undefined) === cursor;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(ChannelListPage);
    TestBed.tick();
  });

  afterEach(() => http.verify());

  const element = () => fixture.nativeElement as HTMLElement;
  const cardTitles = () =>
    Array.from(element().querySelectorAll('app-channel-card .title')).map((title) =>
      title.textContent?.trim(),
    );
  const loadMoreButton = () =>
    Array.from(element().querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Load more'),
    );

  it('shows skeleton cards while the first page loads', () => {
    const request = http.expectOne(isChannelsRequest());
    expect(request.request.params.get('limit')).toBe(String(CHANNEL_PAGE_SIZE));
    fixture.detectChanges();

    expect(element().querySelector('app-skeleton')).not.toBeNull();
    expect(element().querySelector('app-channel-card')).toBeNull();
    request.flush(makePage([]));
  });

  it('shows an empty state that leads to Import Jobs', async () => {
    http.expectOne(isChannelsRequest()).flush(makePage([]));
    await fixture.whenStable();

    const empty = element().querySelector('app-empty-state');
    expect(empty?.textContent).toContain('No channels archived yet');
    expect(empty?.querySelector('a')?.getAttribute('href')).toBe('/imports');
    expect(element().querySelector('app-skeleton')).toBeNull();
  });

  it('shows an error state and loads again on retry', async () => {
    flushError(http.expectOne(isChannelsRequest()), 503, 'Database is down', 'DB_DOWN');
    await fixture.whenStable();

    const errorState = element().querySelector('app-error-state');
    expect(errorState?.textContent).toContain('Channels could not be loaded');
    expect(errorState?.textContent).toContain('Database is down');

    errorState?.querySelector('button')?.click();
    TestBed.tick();
    http.expectOne(isChannelsRequest()).flush(makePage([makeChannel({ title: 'Recovered' })]));
    await fixture.whenStable();

    expect(element().querySelector('app-error-state')).toBeNull();
    expect(cardTitles()).toEqual(['Recovered']);
  });

  it('lists channels with their details', async () => {
    const open = makeChannel({
      title: 'Daily Physics',
      username: 'dailyphysics',
      type: 'CHANNEL',
      stats: { messages: 1_234, media: 56, downloadedMedia: 50, storageBytes: 1024 ** 3 },
      lastSyncedAt: null,
    });
    const locked = makeChannel({
      title: 'Private Study Group',
      username: null,
      type: 'SUPERGROUP',
      isProtected: true,
    });
    http.expectOne(isChannelsRequest()).flush(makePage([open, locked]));
    await fixture.whenStable();

    expect(cardTitles()).toEqual(['Daily Physics', 'Private Study Group']);
    const [first, second] = Array.from(element().querySelectorAll('app-channel-card'));
    expect(first.querySelector('.handle')?.textContent?.trim()).toBe('@dailyphysics · Channel');
    expect(first.textContent).toContain('1,234');
    expect(first.textContent).toContain('56');
    expect(first.textContent).toContain('50 downloaded');
    expect(first.textContent).toContain('1 GiB');
    expect(first.textContent).toContain('Never synced');
    expect(first.querySelector('.badge-protected')).toBeNull();
    expect(first.querySelector('a')?.getAttribute('href')).toBe(`/channels/${open.id}`);
    expect(second.querySelector('.handle')?.textContent?.trim()).toBe('Private · Supergroup');
    expect(second.querySelector('.badge-protected')?.textContent).toContain('Protected');
    expect(second.textContent).toContain('Last synced');
    expect(loadMoreButton()).toBeUndefined();
  });

  it('appends the next page when "Load more" is clicked', async () => {
    http
      .expectOne(isChannelsRequest())
      .flush(makePage([makeChannel({ title: 'First' })], 'cursor-2'));
    await fixture.whenStable();

    loadMoreButton()?.click();
    const next = http.expectOne(isChannelsRequest('cursor-2'));
    expect(next.request.params.get('limit')).toBe(String(CHANNEL_PAGE_SIZE));
    next.flush(makePage([makeChannel({ title: 'Second' })]));
    await fixture.whenStable();

    expect(cardTitles()).toEqual(['First', 'Second']);
    expect(loadMoreButton()).toBeUndefined();
  });

  it('keeps the list and offers "Load more" again when the next page fails', async () => {
    http
      .expectOne(isChannelsRequest())
      .flush(makePage([makeChannel({ title: 'First' })], 'cursor-2'));
    await fixture.whenStable();

    loadMoreButton()?.click();
    flushError(http.expectOne(isChannelsRequest('cursor-2')), 400, 'Invalid cursor');
    await fixture.whenStable();

    expect(cardTitles()).toEqual(['First']);
    expect(element().querySelector('.more-error')?.textContent).toContain('Invalid cursor');
    expect(loadMoreButton()).toBeDefined();
  });
});
