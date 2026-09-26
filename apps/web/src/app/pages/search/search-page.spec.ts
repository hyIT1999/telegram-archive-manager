import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import {
  makeMediaSummary,
  makeMessage,
  makeMessagePage,
  makePage,
} from '../../../testing/fixtures';
import { nextRequest } from '../../../testing/http';
import { MESSAGE_ENDPOINTS } from '../../features/messages/messages-api';
import { SearchPage } from './search-page';

describe('SearchPage', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: 'search', component: SearchPage }], withComponentInputBinding()),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('explains how to search before anything is typed', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/search');
    await harness.fixture.whenStable();
    expect(harness.routeNativeElement?.textContent).toContain('What are you looking for?');
    http.expectNone(MESSAGE_ENDPOINTS.search);
  });

  it('shows the results for the words in the URL, best match first', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/search?q=lens');
    for (const request of http.match((candidate) => candidate.url === '/api/channels')) {
      request.flush(makePage([]));
    }
    const search = await nextRequest(http, MESSAGE_ENDPOINTS.search);
    expect(search.request.params.get('q')).toBe('lens');
    expect(search.request.params.get('sort')).toBe('relevance');
    search.flush(
      makeMessagePage([
        makeMessage({
          media: makeMediaSummary({ fileName: 'Lenses.mp4' }),
          matches: { fileName: [[0, 6]], excerpt: [] },
        }),
      ]),
    );
    await harness.fixture.whenStable();

    const page = harness.routeNativeElement as HTMLElement;
    expect(page.querySelector('h1')?.textContent).toContain('Results for “lens”');
    expect(page.querySelector('mark')?.textContent).toBe('Lenses');
    // The header's box is the search field here.
    expect(page.textContent).not.toContain('Search this list');
    expect(page.textContent).toContain('1 result');
  });
});
