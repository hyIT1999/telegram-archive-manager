import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ApplicationRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { MatDialog, type MatDialogRef } from '@angular/material/dialog';
import { flushError, makeStorageLocation } from '../../../testing/fixtures';
import { nextRequest } from '../../../testing/http';
import type { GoogleDriveConnectDto, StorageLocationDto } from '../../shared/models';
import { GOOGLE_POLL_DELAY, GoogleDriveDialog, type GoogleDriveDialogData } from './google-drive-dialog';
import { STORAGE_ENDPOINTS } from './storage-api';

const FLOW: GoogleDriveConnectDto = {
  flowId: '0199a0b1-0000-7000-8000-00000000f10w',
  userCode: 'ABCD-EFGH',
  verificationUrl: 'https://www.google.com/device',
  expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
  intervalSeconds: 5,
};
const POLL = `${STORAGE_ENDPOINTS.googleConnect}/${FLOW.flowId}/poll`;

describe('GoogleDriveDialog', () => {
  let http: HttpTestingController;
  let dialogRef: MatDialogRef<GoogleDriveDialog, StorageLocationDto>;
  let closedWith: StorageLocationDto | undefined | null;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
        // Poll right away instead of every few seconds.
        { provide: GOOGLE_POLL_DELAY, useValue: () => 0 },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    closedWith = null;
  });

  afterEach(() => {
    dialogRef.close();
    http.verify();
  });

  async function open(data: Partial<GoogleDriveDialogData> = {}): Promise<void> {
    dialogRef = TestBed.inject(MatDialog).open<GoogleDriveDialog, GoogleDriveDialogData, StorageLocationDto>(
      GoogleDriveDialog,
      { data: { available: true, reason: null, location: null, ...data } },
    );
    dialogRef.afterClosed().subscribe((result) => (closedWith = result));
    await settle();
  }

  const dialog = () => document.querySelector('app-google-drive-dialog') as HTMLElement;
  const button = (label: string) =>
    Array.from(dialog().querySelectorAll<HTMLButtonElement>('button')).find((item) =>
      item.textContent?.includes(label),
    );

  async function startWithCode(): Promise<void> {
    button('Get a code')?.click();
    const connect = await nextRequest(http, STORAGE_ENDPOINTS.googleConnect);
    connect.flush(FLOW);
    await settle();
  }

  it('explains when Google Drive is not set up on the server', async () => {
    await open({ available: false, reason: 'Add GOOGLE_OAUTH_CLIENT_ID to .env (README §9).' });
    expect(dialog().textContent).toContain('Add GOOGLE_OAUTH_CLIENT_ID to .env (README §9).');
    expect(button('Get a code')).toBeUndefined();
  });

  it('shows the code, waits for the approval and closes with the new location', async () => {
    await open();
    const fields = Array.from(dialog().querySelectorAll('input')).map((input) => input.value);
    expect(fields).toEqual(['Google Drive', 'Unofficial Telegram Archive']);

    button('Get a code')?.click();
    const connect = await nextRequest(http, STORAGE_ENDPOINTS.googleConnect);
    expect(connect.request.body).toEqual({ name: 'Google Drive', folderName: 'Unofficial Telegram Archive' });
    connect.flush(FLOW);
    await settle();

    expect(dialog().querySelector('.code')?.textContent).toBe('ABCD-EFGH');
    expect(dialog().querySelector('a')?.getAttribute('href')).toBe('https://www.google.com/device');
    expect(dialog().textContent).toMatch(/valid for (29|30):\d\d/);

    (await nextRequest(http, POLL)).flush({ status: 'pending', location: null, intervalSeconds: 10 });
    const location = makeStorageLocation({ kind: 'GOOGLE_DRIVE', name: 'Google Drive' });
    (await nextRequest(http, POLL)).flush({ status: 'authorized', location, intervalSeconds: null });

    await vi.waitFor(() => expect(closedWith).toEqual(location));
  });

  it('reports a declined sign-in and starts over', async () => {
    await open();
    await startWithCode();
    (await nextRequest(http, POLL)).flush({ status: 'denied', location: null, intervalSeconds: null });

    await vi.waitFor(() => expect(dialog().textContent).toContain("Access was declined on Google's page."));
    button('Try again')?.click();
    await settle();
    expect(button('Get a code')).toBeDefined();
    expect(closedWith).toBeNull();
  });

  it('reports an expired code and server errors', async () => {
    await open();
    await startWithCode();
    (await nextRequest(http, POLL)).flush({ status: 'expired', location: null, intervalSeconds: null });
    await vi.waitFor(() => expect(dialog().textContent).toContain('The code expired'));

    button('Try again')?.click();
    await settle();
    button('Get a code')?.click();
    flushError(
      await nextRequest(http, STORAGE_ENDPOINTS.googleConnect),
      503,
      'Set STORAGE_SECRET_KEY on the server first.',
      'GOOGLE_DRIVE_UNAVAILABLE',
    );
    await vi.waitFor(() =>
      expect(dialog().querySelector('app-notice[role="alert"]')?.textContent).toContain('STORAGE_SECRET_KEY'),
    );
  });

  it('reconnects an existing location with its own account', async () => {
    const location = makeStorageLocation({
      kind: 'GOOGLE_DRIVE',
      name: 'Lessons Drive',
      displayPath: 'My Drive › Lessons',
      accountEmail: 'teacher@example.com',
    });
    await open({ location });
    expect(dialog().querySelector('h2')?.textContent).toContain('Reconnect Google Drive');
    expect(dialog().textContent).toContain('Sign in with teacher@example.com');
    expect(dialog().querySelector('input')).toBeNull();

    button('Get a code')?.click();
    const connect = await nextRequest(http, STORAGE_ENDPOINTS.googleConnect);
    expect(connect.request.body).toEqual({
      name: 'Lessons Drive',
      folderName: 'Unofficial Telegram Archive',
      locationId: location.id,
    });
    connect.flush(FLOW);
    (await nextRequest(http, POLL)).flush({ status: 'authorized', location, intervalSeconds: null });
    await vi.waitFor(() => expect(closedWith).toEqual(location));
  });
});

/** Waits until Angular rendered the latest changes (the dialog lives outside a fixture). */
async function settle(): Promise<void> {
  TestBed.tick();
  await TestBed.inject(ApplicationRef).whenStable();
}
