import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { makeMessage, makeMessagePage, makePage } from '../../../testing/fixtures';
import { nextRequest } from '../../../testing/http';
import { MESSAGE_ENDPOINTS } from '../messages/messages-api';
import { FavoritesPage } from './favorites-page';

describe('FavoritesPage', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: 'favorites', component: FavoritesPage }]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  async function open(url = '/favorites') {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(url);
    for (const request of http.match((candidate) => candidate.url === '/api/channels')) {
      request.flush(makePage([]));
    }
    return harness;
  }

  it('lists favorites, the most recently favorited first', async () => {
    const harness = await open();
    const feed = await nextRequest(http, MESSAGE_ENDPOINTS.list);
    expect(feed.request.params.get('favorite')).toBe('true');
    expect(feed.request.params.get('sort')).toBe('favorited');
    feed.flush(
      makeMessagePage([
        makeMessage({ isFavorite: true, mediaGroupId: '7' }),
        makeMessage({ isFavorite: true, mediaGroupId: '7' }),
      ]),
    );
    await harness.fixture.whenStable();

    const page = harness.routeNativeElement as HTMLElement;
    expect(page.querySelector('h1')?.textContent).toContain('Favorites');
    // Favorites of one album are still shown one by one, each with its heart.
    expect(page.querySelectorAll('app-message-card')).toHaveLength(2);
    // Favorites are fixed: no chip to turn them off.
    expect(page.querySelector('app-feed-filters')?.textContent).not.toContain('Favorites');
    expect(page.querySelector('app-favorite-button button')?.getAttribute('aria-pressed')).toBe(
      'true',
    );
  });

  it('explains how to add favorites while there are none', async () => {
    const harness = await open();
    (await nextRequest(http, MESSAGE_ENDPOINTS.list)).flush(makeMessagePage([]));
    await harness.fixture.whenStable();
    const text = harness.routeNativeElement?.textContent ?? '';
    expect(text).toContain('No favorites yet');
    expect(text).toContain('Press ♥ on a message to keep it here.');
    expect(text).not.toContain('Import a channel');
  });

  it('searches favorites by best match', async () => {
    const harness = await open('/favorites?q=lens');
    const search = await nextRequest(http, MESSAGE_ENDPOINTS.search);
    expect(search.request.params.get('favorite')).toBe('true');
    expect(search.request.params.get('sort')).toBe('relevance');
    search.flush(makeMessagePage([]));
    await harness.fixture.whenStable();
    expect(harness.routeNativeElement?.textContent).toContain('No results for “lens”');
  });
});
