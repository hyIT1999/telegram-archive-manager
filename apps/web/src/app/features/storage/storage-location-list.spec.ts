import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { MatDialog } from '@angular/material/dialog';
import { of } from 'rxjs';
import {
  flushError,
  makeStorageCheck,
  makeStorageList,
  makeStorageLocation,
} from '../../../testing/fixtures';
import { nextRequest } from '../../../testing/http';
import { ConfirmService } from '../../core/services/confirm-service';
import { NotifyService } from '../../core/services/notify-service';
import type { StorageLocationDto } from '../../shared/models';
import { GoogleDriveDialog } from './google-drive-dialog';
import { LocalFolderDialog } from './local-folder-dialog';
import { STORAGE_ENDPOINTS } from './storage-api';
import { StorageLocationList } from './storage-location-list';

describe('StorageLocationList', () => {
  let fixture: ComponentFixture<StorageLocationList>;
  let http: HttpTestingController;
  let dialogResult: StorageLocationDto | undefined;
  const confirm = { ask: vi.fn<() => Promise<boolean>>() };
  const notify = { success: vi.fn(), info: vi.fn(), error: vi.fn() };
  const dialog = { open: vi.fn(() => ({ afterClosed: () => of(dialogResult) })) };

  const computer = makeStorageLocation({ name: 'This computer', builtIn: true, isDefault: true, displayPath: 'D:\\Archive' });
  const drive = makeStorageLocation({
    kind: 'GOOGLE_DRIVE',
    name: 'Drive',
    displayPath: 'My Drive › Unofficial Telegram Archive',
    accountEmail: 'teacher@example.com',
  });

  function setup(selectable = false): void {
    dialogResult = undefined;
    confirm.ask.mockReset();
    notify.success.mockReset();
    notify.error.mockReset();
    dialog.open.mockClear();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
        { provide: MatDialog, useValue: dialog },
        { provide: ConfirmService, useValue: confirm },
        { provide: NotifyService, useValue: notify },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(StorageLocationList);
    fixture.componentRef.setInput('selectable', selectable);
    TestBed.tick();
  }

  afterEach(() => http.verify());

  const page = () => fixture.nativeElement as HTMLElement;
  const cardOf = (name: string) =>
    Array.from(page().querySelectorAll<HTMLElement>('.location')).find(
      (card) => card.querySelector('.name')?.textContent?.includes(name),
    );
  const button = (label: string) =>
    Array.from(page().querySelectorAll<HTMLButtonElement>('button')).find((item) =>
      item.textContent?.includes(label),
    );

  async function showList(items: StorageLocationDto[], capabilities = {}): Promise<void> {
    http.expectOne(STORAGE_ENDPOINTS.locations).flush(makeStorageList(items, capabilities));
    await fixture.whenStable();
  }

  async function answerCheck(location: StorageLocationDto, check = makeStorageCheck(location)): Promise<void> {
    (await nextRequest(http, `${STORAGE_ENDPOINTS.locations}/${location.id}/check`)).flush(check);
    await fixture.whenStable();
  }

  async function menuItem(card: HTMLElement | undefined, label: string): Promise<HTMLButtonElement | undefined> {
    card?.querySelector<HTMLButtonElement>('button.menu')?.click();
    await fixture.whenStable();
    return Array.from(document.querySelectorAll<HTMLButtonElement>('.mat-mdc-menu-item')).find((item) =>
      item.textContent?.includes(label),
    );
  }

  it('shows each location with its free space, account and state', async () => {
    setup();
    const broken = makeStorageLocation({ name: 'Old disk', displayPath: 'E:\\Old' });
    await showList([computer, drive, broken]);
    expect(cardOf('This computer')?.textContent).toContain('Checking…');

    await answerCheck(computer);
    await answerCheck(drive, makeStorageCheck(drive, { space: { freeBytes: null, totalBytes: null, usedBytes: 3 * 1024 ** 3 } }));
    await answerCheck(
      broken,
      makeStorageCheck({ ...broken, lastError: 'No permission to write to E:\\Old.' }, { ok: false, space: null }),
    );

    expect(cardOf('This computer')?.textContent).toContain('Default');
    expect(cardOf('This computer')?.textContent).toContain('120 GiB free of 500 GiB');
    expect(cardOf('Drive')?.textContent).toContain('teacher@example.com');
    expect(cardOf('Drive')?.textContent).toContain('3 GiB used');
    const status = cardOf('Old disk')?.querySelector('.status');
    expect(status?.getAttribute('data-state')).toBe('failed');
    expect(status?.textContent).toContain('No permission to write to E:\\Old.');
    expect(page().querySelector('input[type="radio"]')).toBeNull();
  });

  it('picks the default location, then the one chosen', async () => {
    setup(true);
    await showList([computer, drive]);
    await answerCheck(computer);
    await answerCheck(drive);

    const radios = Array.from(page().querySelectorAll<HTMLInputElement>('input[type="radio"]'));
    expect(radios.map((radio) => radio.checked)).toEqual([true, false]);
    expect(fixture.componentInstance.selectedId()).toBe(computer.id);

    radios[1]?.click();
    await fixture.whenStable();
    expect(fixture.componentInstance.selectedId()).toBe(drive.id);
    expect(cardOf('Drive')?.classList).toContain('selected');
  });

  it('adds a folder on this computer, checks it and picks it', async () => {
    setup(true);
    await showList([computer]);
    await answerCheck(computer);

    const added = makeStorageLocation({ name: 'Lessons', displayPath: 'D:\\Archive\\Lessons' });
    dialogResult = added;
    button('Folder on this computer')?.click();
    expect(dialog.open).toHaveBeenCalledWith(LocalFolderDialog, expect.objectContaining({ data: { roots: ['D:\\Archive'] } }));
    await answerCheck(added);

    expect(cardOf('Lessons')?.textContent).toContain('D:\\Archive\\Lessons');
    expect(fixture.componentInstance.selectedId()).toBe(added.id);
  });

  it('explains when folders on this computer cannot be added', async () => {
    setup();
    await showList([], { localRoots: [] });
    expect(button('Folder on this computer')?.disabled).toBe(true);
    expect(page().textContent).toContain('STORAGE_LOCAL_ROOTS');
    expect(page().textContent).toContain('No storage location yet');
  });

  it('opens the Google Drive dialog with what the server says', async () => {
    setup();
    await showList([computer], { googleDrive: { available: false, reason: 'Set GOOGLE_OAUTH_CLIENT_ID.' } });
    await answerCheck(computer);

    button('Google Drive')?.click();
    expect(dialog.open).toHaveBeenCalledWith(
      GoogleDriveDialog,
      expect.objectContaining({ data: { available: false, reason: 'Set GOOGLE_OAUTH_CLIENT_ID.', location: null } }),
    );
    expect(page().querySelectorAll('.location')).toHaveLength(1);
  });

  it('makes a location the default', async () => {
    setup();
    await showList([computer, drive]);
    await answerCheck(computer);
    await answerCheck(drive);

    (await menuItem(cardOf('Drive'), 'Use as default'))?.click();
    const update = await nextRequest(http, `${STORAGE_ENDPOINTS.locations}/${drive.id}`);
    expect(update.request.method).toBe('PATCH');
    expect(update.request.body).toEqual({ isDefault: true });
    update.flush({ ...drive, isDefault: true });
    (await nextRequest(http, STORAGE_ENDPOINTS.locations)).flush(
      makeStorageList([{ ...computer, isDefault: false }, { ...drive, isDefault: true }]),
    );
    await fixture.whenStable();

    expect(cardOf('Drive')?.textContent).toContain('Default');
    expect(notify.success).toHaveBeenCalledWith('Drive is now the default location.');
  });

  it('removes a location only after confirmation, and never the built-in one', async () => {
    setup();
    await showList([computer, drive]);
    await answerCheck(computer);
    await answerCheck(drive);

    expect(await menuItem(cardOf('This computer'), 'Remove')).toBeUndefined();
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

    confirm.ask.mockResolvedValueOnce(false);
    (await menuItem(cardOf('Drive'), 'Remove'))?.click();
    await vi.waitFor(() => expect(confirm.ask).toHaveBeenCalledTimes(1));
    http.expectNone(`${STORAGE_ENDPOINTS.locations}/${drive.id}`);

    confirm.ask.mockResolvedValueOnce(true);
    (await menuItem(cardOf('Drive'), 'Remove'))?.click();
    const remove = await nextRequest(http, `${STORAGE_ENDPOINTS.locations}/${drive.id}`);
    expect(remove.request.method).toBe('DELETE');
    remove.flush(null, { status: 204, statusText: 'No Content' });

    await vi.waitFor(() => expect(cardOf('Drive')).toBeUndefined());
    expect(notify.success).toHaveBeenCalledWith('Drive was removed.');
  });

  it('shows an error state when the list cannot be loaded, and retries', async () => {
    setup();
    flushError(http.expectOne(STORAGE_ENDPOINTS.locations), 500, 'boom');
    await fixture.whenStable();

    const errorState = page().querySelector('app-error-state');
    expect(errorState?.textContent).toContain('Storage locations could not be loaded');
    errorState?.querySelector('button')?.click();
    TestBed.tick();
    await showList([]);
    expect(page().textContent).toContain('No storage location yet');
  });
});
