import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { flushError, makeSettings } from '../../../testing/fixtures';
import { nextRequest } from '../../../testing/http';
import { SETTINGS_ENDPOINT } from './settings-api';
import { SyncSettingsPanel } from './sync-settings';

describe('SyncSettingsPanel', () => {
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

  async function render() {
    const fixture = TestBed.createComponent(SyncSettingsPanel);
    TestBed.tick();
    http.expectOne(SETTINGS_ENDPOINT).flush(makeSettings({}, { intervalMinutes: 60 }));
    await fixture.whenStable();
    return { fixture, element: fixture.nativeElement as HTMLElement };
  }

  async function pick(element: HTMLElement, label: string) {
    element.querySelector<HTMLElement>('.mat-mdc-select-trigger')?.click();
    await vi.waitFor(() => {
      const option = Array.from(document.querySelectorAll<HTMLElement>('mat-option')).find(
        (candidate) => candidate.textContent?.includes(label),
      );
      if (!option) {
        throw new Error(`No option "${label}" yet`);
      }
      option.click();
    });
  }

  it('shows the saved interval and saves another one at once', async () => {
    const { fixture, element } = await render();
    expect(element.querySelector('mat-select')?.textContent).toContain('Every hour');

    await pick(element, 'Every 3 hours');
    const request = await nextRequest(http, SETTINGS_ENDPOINT);
    expect(request.request.method).toBe('PATCH');
    expect(request.request.body).toEqual({ sync: { intervalMinutes: 180 } });
    request.flush(makeSettings({}, { intervalMinutes: 180 }));
    await fixture.whenStable();
    expect(element.textContent).toContain('Saved.');
    expect(element.querySelector('mat-select')?.textContent).toContain('Every 3 hours');
  });

  it('shows a refused change and keeps the saved interval', async () => {
    const { fixture, element } = await render();
    await pick(element, 'Once a day');
    flushError(await nextRequest(http, SETTINGS_ENDPOINT), 400, 'Invalid input');
    await fixture.whenStable();
    expect(element.textContent).toContain('Invalid input');
    expect(element.querySelector('mat-select')?.textContent).toContain('Every hour');
  });
});
