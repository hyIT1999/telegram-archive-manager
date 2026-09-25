import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { flushError, makeSettings } from '../../../testing/fixtures';
import { nextRequest } from '../../../testing/http';
import { DownloadSettingsPanel } from './download-settings';
import { SETTINGS_ENDPOINT } from './settings-api';

describe('DownloadSettingsPanel', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  async function render(settings = makeSettings()) {
    const fixture = TestBed.createComponent(DownloadSettingsPanel);
    TestBed.tick();
    http.expectOne(SETTINGS_ENDPOINT).flush(settings);
    await fixture.whenStable();
    return { fixture, element: fixture.nativeElement as HTMLElement };
  }

  const saveButton = (element: HTMLElement) =>
    Array.from(element.querySelectorAll<HTMLButtonElement>('button')).find((button) =>
      button.textContent?.includes('Save changes'),
    );

  it('pauses every download at once', async () => {
    const { fixture, element } = await render();
    element.querySelector<HTMLButtonElement>('mat-slide-toggle button')?.click();
    const request = await nextRequest(http, SETTINGS_ENDPOINT);
    expect(request.request.method).toBe('PATCH');
    expect(request.request.body).toEqual({ downloads: { paused: true } });
    request.flush(makeSettings({ paused: true }));
    await fixture.whenStable();
    expect(element.querySelector('mat-slide-toggle button')?.getAttribute('aria-checked')).toBe(
      'true',
    );
  });

  it('saves the types, the largest automatic file and the files at a time', async () => {
    const { fixture, element } = await render();
    expect(element.textContent).toContain('keep 2 GiB free');
    expect(saveButton(element)?.disabled).toBe(true);

    const videos = Array.from(element.querySelectorAll('mat-checkbox')).find((box) =>
      box.textContent?.includes('Videos'),
    );
    videos?.querySelector<HTMLInputElement>('input')?.click();
    const size = element.querySelector<HTMLInputElement>('input[type="number"]');
    if (size) {
      size.value = '200';
      size.dispatchEvent(new Event('input'));
    }
    await fixture.whenStable();
    expect(saveButton(element)?.disabled).toBe(false);

    saveButton(element)?.click();
    const request = await nextRequest(http, SETTINGS_ENDPOINT);
    expect(request.request.body).toEqual({
      downloads: {
        mediaTypes: ['PHOTO', 'DOCUMENT', 'AUDIO', 'VOICE', 'ANIMATION', 'VIDEO_NOTE', 'STICKER'],
        maxFileSizeMb: 200,
        concurrency: 2,
      },
    });
    request.flush(makeSettings({ mediaTypes: ['PHOTO', 'DOCUMENT'], maxFileSizeMb: 200 }));
    await fixture.whenStable();
    expect(element.textContent).toContain('Saved.');
    expect(saveButton(element)?.disabled).toBe(true);
  });

  it('refuses a size it cannot save, and shows server errors', async () => {
    const { fixture, element } = await render();
    const size = element.querySelector<HTMLInputElement>('input[type="number"]');
    if (size) {
      size.value = '0';
      size.dispatchEvent(new Event('input'));
    }
    await fixture.whenStable();
    expect(element.textContent).toContain('Enter a whole number of MB from 1 to 4096');
    expect(saveButton(element)?.disabled).toBe(true);

    if (size) {
      size.value = '';
      size.dispatchEvent(new Event('input'));
    }
    const photos = Array.from(element.querySelectorAll('mat-checkbox')).find((box) =>
      box.textContent?.includes('Photos'),
    );
    photos?.querySelector<HTMLInputElement>('input')?.click();
    await fixture.whenStable();
    saveButton(element)?.click();
    flushError(await nextRequest(http, SETTINGS_ENDPOINT), 400, 'Nothing to change');
    await fixture.whenStable();
    expect(element.querySelector('app-notice[data-tone="error"]')?.textContent).toContain(
      'Nothing to change',
    );
  });
});
