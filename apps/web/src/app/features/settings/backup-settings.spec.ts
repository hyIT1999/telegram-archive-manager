import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { flushError, makeSettings } from '../../../testing/fixtures';
import { nextRequest } from '../../../testing/http';
import { BackupSettingsPanel } from './backup-settings';
import { SETTINGS_ENDPOINT } from './settings-api';

describe('BackupSettingsPanel', () => {
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

  async function render(paused = false) {
    const fixture = TestBed.createComponent(BackupSettingsPanel);
    TestBed.tick();
    http.expectOne(SETTINGS_ENDPOINT).flush(makeSettings({}, {}, { paused }));
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    const toggle = () => element.querySelector<HTMLButtonElement>('mat-slide-toggle button');
    return { fixture, element, toggle };
  }

  it('pauses every backup at once, and resumes them', async () => {
    const { fixture, element, toggle } = await render();
    expect(element.textContent).toContain('Pause all backups');
    expect(toggle()?.getAttribute('aria-checked')).toBe('false');

    toggle()?.click();
    const pause = await nextRequest(http, SETTINGS_ENDPOINT);
    expect(pause.request.method).toBe('PATCH');
    expect(pause.request.body).toEqual({ backups: { paused: true } });
    pause.flush(makeSettings({}, {}, { paused: true }));
    await fixture.whenStable();
    expect(toggle()?.getAttribute('aria-checked')).toBe('true');

    toggle()?.click();
    const resume = await nextRequest(http, SETTINGS_ENDPOINT);
    expect(resume.request.body).toEqual({ backups: { paused: false } });
    resume.flush(makeSettings());
    await fixture.whenStable();
    expect(toggle()?.getAttribute('aria-checked')).toBe('false');
  });

  it('shows the switch where it really is when saving fails', async () => {
    const { fixture, element, toggle } = await render(true);
    toggle()?.click();
    flushError(await nextRequest(http, SETTINGS_ENDPOINT), 400, 'Nothing to change');
    await fixture.whenStable();
    expect(element.querySelector('app-notice[role="alert"]')?.textContent).toContain(
      'Nothing to change',
    );
    expect(toggle()?.getAttribute('aria-checked')).toBe('true');
  });
});
