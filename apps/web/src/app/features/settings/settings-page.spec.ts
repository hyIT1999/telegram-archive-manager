import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import {
  makeReadyStatus,
  makeSettings,
  makeStorageCheck,
  makeStorageList,
  makeStorageLocation,
} from '../../../testing/fixtures';
import { nextRequest } from '../../../testing/http';
import { STORAGE_ENDPOINTS } from '../storage/storage-api';
import { SETTINGS_ENDPOINT } from './settings-api';
import { TELEGRAM_ENDPOINTS } from '../telegram/telegram-api';
import { SettingsPage } from './settings-page';

describe('SettingsPage', () => {
  it('shows the Telegram account, storage locations, download and sync settings, and the appearance', async () => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
      ],
    });
    const http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(SettingsPage);
    TestBed.tick();

    const computer = makeStorageLocation({ name: 'This computer', builtIn: true, isDefault: true });
    http.expectOne(TELEGRAM_ENDPOINTS.status).flush(makeReadyStatus());
    http.expectOne(STORAGE_ENDPOINTS.locations).flush(makeStorageList([computer]));
    // The download and the sync settings each read them.
    const settings = http.match(SETTINGS_ENDPOINT);
    expect(settings).toHaveLength(2);
    for (const request of settings) {
      request.flush(makeSettings());
    }
    (await nextRequest(http, `${STORAGE_ENDPOINTS.locations}/${computer.id}/check`)).flush(
      makeStorageCheck(computer),
    );
    await fixture.whenStable();

    const page = fixture.nativeElement as HTMLElement;
    const headings = Array.from(page.querySelectorAll('h2')).map((title) => title.textContent);
    expect(headings).toEqual([
      'Telegram account',
      'Storage locations',
      'Media downloads',
      'Sync',
      'Appearance',
    ]);
    expect(page.querySelector('app-sync-settings mat-select')?.textContent).toContain(
      'Every 15 minutes',
    );
    expect(page.querySelector('app-download-settings')?.textContent).toContain(
      'Pause all downloads',
    );
    expect(page.querySelector('app-telegram-connect .account-name')?.textContent).toContain(
      'An Archivist',
    );
    expect(page.querySelector('app-storage-location-list')?.textContent).toContain('This computer');
    // Settings manages the locations; nothing is picked here.
    expect(page.querySelector('app-storage-location-list input[type="radio"]')).toBeNull();
    http.verify();
  });
});
