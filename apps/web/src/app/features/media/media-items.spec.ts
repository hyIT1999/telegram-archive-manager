import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { provideRouter } from '@angular/router';
import { makeMediaSummary, makeMessage, makeTag, tagRef } from '../../../testing/fixtures';
import { MediaRow } from './media-row';
import { MediaTile } from './media-tile';

const ITEM = makeMessage({
  isFavorite: true,
  media: makeMediaSummary({ fileName: 'Wave zone.pdf', mimeType: 'application/pdf' }),
  matches: { fileName: [[5, 4]], excerpt: [] },
  tags: ['A', 'B', 'C', 'D'].map((name) => tagRef(makeTag({ name }))),
});

@Component({
  template: `<app-media-tile [item]="item" /><app-media-row [item]="item" />`,
  imports: [MediaRow, MediaTile],
})
class Host {
  readonly item = ITEM;
}

describe('media tiles and rows', () => {
  let http: HttpTestingController;

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
  });

  afterEach(() => http.verify());

  it('show the heart, the words found and a few tags', async () => {
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;

    const tile = element.querySelector('app-media-tile') as HTMLElement;
    // The heart sits beside the link, never inside it.
    expect(tile.querySelector('a app-favorite-button')).toBeNull();
    expect(tile.querySelector('app-favorite-button.on button')?.getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(tile.querySelector('.title mark')?.textContent).toBe('zone');

    const row = element.querySelector('app-media-row') as HTMLElement;
    expect(row.querySelector('app-favorite-button button')?.getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(
      Array.from(row.querySelectorAll('app-tag-chip')).map((chip) => chip.textContent?.trim()),
    ).toEqual(['A', 'B', 'C']);
    expect(row.querySelector('.tags .more')?.textContent).toBe('+1');
    expect(row.querySelector('.title mark')?.textContent).toBe('zone');
  });
});
