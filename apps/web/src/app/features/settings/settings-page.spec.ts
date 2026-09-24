import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { makeReadyStatus } from '../../../testing/fixtures';
import { TELEGRAM_ENDPOINTS } from '../telegram/telegram-api';
import { SettingsPage } from './settings-page';

describe('SettingsPage', () => {
  it('shows the connected Telegram account next to the appearance settings', async () => {
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

    http.expectOne(TELEGRAM_ENDPOINTS.status).flush(makeReadyStatus());
    await fixture.whenStable();

    const page = fixture.nativeElement as HTMLElement;
    const headings = Array.from(page.querySelectorAll('h2')).map((title) => title.textContent);
    expect(headings).toEqual(['Telegram account', 'Appearance', 'Archive settings are on their way']);
    expect(page.querySelector('app-telegram-connect .account-name')?.textContent).toContain(
      'An Archivist',
    );
    expect(page.textContent).toContain('Log out of Telegram');
    http.verify();
  });
});
