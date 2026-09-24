import { type HttpRequest, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ApplicationRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { MatDialog, type MatDialogRef } from '@angular/material/dialog';
import { flushError, makeStorageLocation } from '../../../testing/fixtures';
import type { LocalFolderListDto, StorageLocationDto } from '../../shared/models';
import { LocalFolderDialog } from './local-folder-dialog';
import { STORAGE_ENDPOINTS } from './storage-api';

const ROOT = 'D:\\Archive';

describe('LocalFolderDialog', () => {
  let http: HttpTestingController;
  let dialogRef: MatDialogRef<LocalFolderDialog, StorageLocationDto>;
  let closedWith: StorageLocationDto | undefined | null;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    closedWith = null;
    dialogRef = TestBed.inject(MatDialog).open<LocalFolderDialog, unknown, StorageLocationDto>(LocalFolderDialog, {
      data: { roots: [ROOT] },
    });
    dialogRef.afterClosed().subscribe((result) => (closedWith = result));
    TestBed.tick();
  });

  afterEach(() => {
    dialogRef.close();
    http.verify();
  });

  const dialog = () => document.querySelector('app-local-folder-dialog') as HTMLElement;
  const button = (label: string) =>
    Array.from(dialog().querySelectorAll<HTMLButtonElement>('button')).find((item) =>
      item.textContent?.includes(label),
    );
  const isFolders = (path?: string) => (request: HttpRequest<unknown>) =>
    request.url === STORAGE_ENDPOINTS.folders && (request.params.get('path') ?? undefined) === path;

  async function answerFolders(path: string | undefined, listing: LocalFolderListDto): Promise<void> {
    await vi.waitFor(() => http.expectOne(isFolders(path)).flush(listing));
    await settle();
  }

  function type(label: string, value: string): void {
    const field = Array.from(dialog().querySelectorAll('mat-form-field')).find((item) =>
      item.textContent?.includes(label),
    );
    const input = field?.querySelector('input');
    if (!input) {
      throw new Error(`No field ${label}`);
    }
    input.value = value;
    input.dispatchEvent(new Event('input'));
  }

  const roots: LocalFolderListDto = { path: null, parent: null, folders: [{ name: ROOT, path: ROOT }], truncated: false };
  const archive: LocalFolderListDto = {
    path: ROOT,
    parent: null,
    folders: [{ name: 'Lessons', path: `${ROOT}\\Lessons` }],
    truncated: false,
  };

  it('browses from the allowed folders into subfolders and back up', async () => {
    await answerFolders(undefined, roots);
    expect(dialog().textContent).toContain(`inside ${ROOT}`);
    expect(button('Use this folder')?.disabled).toBe(true);

    button(ROOT)?.click();
    await answerFolders(ROOT, archive);
    expect(dialog().querySelector('.current')?.textContent).toBe(ROOT);
    expect(button('Use this folder')?.disabled).toBe(false);

    button('Lessons')?.click();
    await answerFolders(`${ROOT}\\Lessons`, { path: `${ROOT}\\Lessons`, parent: ROOT, folders: [], truncated: false });
    expect(dialog().textContent).toContain('No subfolders here.');

    button('Up one level')?.click();
    await answerFolders(ROOT, archive);
    button('Back to the allowed folders')?.click();
    await answerFolders(undefined, roots);
    expect(dialog().querySelector('.current')?.textContent).toContain('Choose one of the allowed folders');
  });

  it('creates the location, with an optional new folder, and closes with it', async () => {
    await answerFolders(undefined, roots);
    button(ROOT)?.click();
    await answerFolders(ROOT, archive);

    type('New folder inside', 'Telegram');
    await settle();
    expect(dialog().querySelector('.target')?.textContent).toContain(`${ROOT}\\Telegram`);

    button('Use this folder')?.click();
    const create = http.expectOne(STORAGE_ENDPOINTS.locations);
    expect(create.request.method).toBe('POST');
    expect(create.request.body).toEqual({ name: 'Telegram', path: ROOT, subfolder: 'Telegram' });
    const location = makeStorageLocation({ name: 'Telegram', displayPath: `${ROOT}\\Telegram` });
    create.flush(location);

    await vi.waitFor(() => expect(closedWith).toEqual(location));
  });

  it('explains a folder that cannot be used and stays open', async () => {
    await answerFolders(undefined, roots);
    button(ROOT)?.click();
    await answerFolders(ROOT, archive);
    type('Name in the archive', 'Archive');

    button('Use this folder')?.click();
    flushError(http.expectOne(STORAGE_ENDPOINTS.locations), 422, `No permission to write to ${ROOT}.`, 'STORAGE_NOT_WRITABLE');

    await vi.waitFor(() =>
      expect(dialog().querySelector('app-notice[role="alert"]')?.textContent).toContain('No permission to write'),
    );
    expect(closedWith).toBeNull();
  });

  it('shows why a folder cannot be opened', async () => {
    await answerFolders(undefined, roots);
    button(ROOT)?.click();
    await vi.waitFor(() =>
      flushError(http.expectOne(isFolders(ROOT)), 422, 'This folder links outside the allowed folders.', 'PATH_NOT_ALLOWED'),
    );
    await vi.waitFor(() =>
      expect(dialog().querySelector('app-notice[role="alert"]')?.textContent).toContain('links outside'),
    );
  });
});

/** Waits until Angular rendered the latest changes (the dialog lives outside a fixture). */
async function settle(): Promise<void> {
  TestBed.tick();
  await TestBed.inject(ApplicationRef).whenStable();
}
