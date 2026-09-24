import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { provideRouter } from '@angular/router';
import {
  flushError,
  makeChannel,
  makeDialog,
  makeDialogList,
  makeReadyStatus,
  makeStorageCheck,
  makeStorageList,
  makeStorageLocation,
  makeTelegramStatus,
} from '../../../testing/fixtures';
import { nextRequest } from '../../../testing/http';
import { ConfirmService } from '../../core/services/confirm-service';
import { NotifyService } from '../../core/services/notify-service';
import type { TelegramDialogDto } from '../../shared/models';
import { STORAGE_ENDPOINTS } from '../storage/storage-api';
import { TELEGRAM_ENDPOINTS } from '../telegram/telegram-api';
import { TELEGRAM_POLLING } from '../telegram/telegram-session';
import { ImportWizardPage } from './import-wizard-page';

const CHANNEL_ID = '0199a0b1-0000-7000-8000-00000000c0de';

describe('ImportWizardPage', () => {
  let fixture: ComponentFixture<ImportWizardPage>;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
        { provide: TELEGRAM_POLLING, useValue: { statusMs: 60_000, chatsMs: 60_000 } },
        { provide: NotifyService, useValue: { success: vi.fn(), info: vi.fn(), error: vi.fn() } },
        { provide: ConfirmService, useValue: { ask: vi.fn() } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(ImportWizardPage);
    TestBed.tick();
  });

  afterEach(() => http.verify());

  const page = () => fixture.nativeElement as HTMLElement;
  const heading = () => page().querySelector('.panel-title')?.textContent?.trim();
  const stepButtons = () => Array.from(page().querySelectorAll<HTMLButtonElement>('.step-button'));
  const button = (label: string) =>
    Array.from(page().querySelectorAll<HTMLButtonElement>('.panel button')).find((item) =>
      item.textContent?.includes(label),
    );
  const radioOf = (title: string) =>
    Array.from(page().querySelectorAll('.chat'))
      .find((row) => row.querySelector('.title')?.textContent?.trim() === title)
      ?.querySelector<HTMLInputElement>('input[type="radio"]');

  async function signedInWith(chats: TelegramDialogDto[]): Promise<void> {
    http.expectOne(TELEGRAM_ENDPOINTS.status).flush(makeReadyStatus());
    (await nextRequest(http, TELEGRAM_ENDPOINTS.chats)).flush(makeDialogList(chats));
    await vi.waitFor(() => {
      expect(heading()).toBe('Channels & groups');
      expect(page().querySelectorAll('.chat').length).toBe(chats.length);
    });
  }

  async function chooseAndContinue(title: string): Promise<void> {
    radioOf(title)?.click();
    await fixture.whenStable();
    button('Continue')?.click();
    await vi.waitFor(() => expect(heading()).toBe('Select channel'));
  }

  it('starts by connecting Telegram, with the later steps closed', async () => {
    http.expectOne(TELEGRAM_ENDPOINTS.status).flush(makeTelegramStatus());
    await fixture.whenStable();

    expect(heading()).toBe('Connect Telegram');
    expect(page().querySelector('app-telegram-connect input[type="tel"]')).not.toBeNull();
    const steps = stepButtons();
    expect(steps.map((step) => step.querySelector('.step-label')?.textContent)).toEqual([
      'Connect Telegram',
      'Channels & groups',
      'Select channel',
      'Storage location',
      'Import mode',
      'Start',
      'Progress',
    ]);
    expect(steps[0].getAttribute('aria-current')).toBe('step');
    expect(steps.slice(1).every((step) => step.disabled)).toBe(true);
    expect(page().querySelectorAll('.step-note').length).toBe(3);
    http.expectNone(TELEGRAM_ENDPOINTS.chats);
  });

  it('moves on to the chat list once signed in, then adds the chosen chat', async () => {
    const lessons = makeDialog({ title: 'Lessons', username: 'lessons', type: 'CHANNEL' });
    await signedInWith([lessons]);
    expect(stepButtons()[1].getAttribute('aria-current')).toBe('step');
    expect(button('Continue')?.disabled).toBe(true);

    await chooseAndContinue('Lessons');
    expect(page().querySelector('.chosen-title')?.textContent).toBe('Lessons');
    expect(page().querySelector('.chosen-details')?.textContent).toBe('@lessons · Channel');

    button('Add to archive')?.click();
    const create = await nextRequest(http, '/api/channels');
    expect(create.request.method).toBe('POST');
    expect(create.request.body).toEqual({ telegramChatId: lessons.telegramChatId });
    create.flush(makeChannel({ id: CHANNEL_ID, title: 'Lessons' }), {
      status: 201,
      statusText: 'Created',
    });

    await vi.waitFor(() =>
      expect(page().querySelector('app-notice')?.textContent).toContain('Added to your archive'),
    );
    expect(button('Choose where to save')).toBeDefined();
    expect(stepButtons()[2].closest('.step')?.classList).toContain('done');
    expect(stepButtons()[3].disabled).toBe(false);

    button('Add another chat')?.click();
    await vi.waitFor(() => expect(heading()).toBe('Channels & groups'));
    expect(page().querySelector('.badge-archived')?.textContent).toContain('In archive');
    expect(button('Continue')?.disabled).toBe(true);
  });

  it('reuses a chat that is already in the archive', async () => {
    await signedInWith([makeDialog({ title: 'Lessons', archivedChannelId: CHANNEL_ID })]);
    await chooseAndContinue('Lessons');

    button('Use this chat')?.click();
    (await nextRequest(http, '/api/channels')).flush(
      makeChannel({ id: CHANNEL_ID, title: 'Lessons' }),
    );

    await vi.waitFor(() =>
      expect(page().querySelector('app-notice')?.textContent).toContain('Already in your archive'),
    );
  });

  it('goes back to the list when the chat turned protected', async () => {
    const lessons = makeDialog({ title: 'Lessons' });
    await signedInWith([lessons]);
    await chooseAndContinue('Lessons');

    button('Add to archive')?.click();
    flushError(
      await nextRequest(http, '/api/channels'),
      422,
      'This chat has content protection enabled; it cannot be archived',
      'CHAT_PROTECTED',
    );
    (await nextRequest(http, TELEGRAM_ENDPOINTS.chats)).flush(
      makeDialogList([{ ...lessons, isProtected: true }]),
    );

    await vi.waitFor(() => expect(heading()).toBe('Channels & groups'));
    expect(page().querySelector('app-notice[role="alert"]')?.textContent).toContain(
      'content protection',
    );
    expect(radioOf('Lessons')?.disabled).toBe(true);
    expect(button('Continue')?.disabled).toBe(true);
  });

  it('returns to the first step when the Telegram session is gone', async () => {
    await signedInWith([makeDialog({ title: 'Lessons' })]);

    button('Refresh')?.click();
    flushError(
      await nextRequest(http, TELEGRAM_ENDPOINTS.refreshChats),
      409,
      'The Telegram session was revoked; log in again',
      'SESSION_REVOKED',
    );
    (await nextRequest(http, TELEGRAM_ENDPOINTS.status)).flush(
      makeTelegramStatus({ lastError: 'The Telegram session was revoked; log in again' }),
    );

    await vi.waitFor(() => expect(heading()).toBe('Connect Telegram'));
    expect(page().textContent).toContain('The Telegram session was revoked; log in again');
    expect(stepButtons()[1].disabled).toBe(true);
  });

  it('saves where the media of the new channel goes', async () => {
    const lessons = makeDialog({ title: 'Lessons', type: 'CHANNEL' });
    await signedInWith([lessons]);
    await chooseAndContinue('Lessons');
    button('Add to archive')?.click();
    const channel = makeChannel({ id: CHANNEL_ID, title: 'Lessons', telegramChatId: '-1001234' });
    (await nextRequest(http, '/api/channels')).flush(channel, { status: 201, statusText: 'Created' });
    await vi.waitFor(() => expect(button('Choose where to save')).toBeDefined());

    button('Choose where to save')?.click();
    await vi.waitFor(() => expect(heading()).toBe('Storage location'));
    const computer = makeStorageLocation({ name: 'This computer', builtIn: true, isDefault: true });
    const drive = makeStorageLocation({
      kind: 'GOOGLE_DRIVE',
      name: 'Drive',
      displayPath: 'My Drive › Unofficial Telegram Archive',
      accountEmail: 'teacher@example.com',
    });
    (await nextRequest(http, STORAGE_ENDPOINTS.locations)).flush(makeStorageList([computer, drive]));
    for (const location of [computer, drive]) {
      (await nextRequest(http, `${STORAGE_ENDPOINTS.locations}/${location.id}/check`)).flush(
        makeStorageCheck(location),
      );
    }

    // The default location is picked until another is chosen.
    const radios = () => Array.from(page().querySelectorAll<HTMLInputElement>('app-storage-location-list input[type="radio"]'));
    await vi.waitFor(() => expect(radios().map((radio) => radio.checked)).toEqual([true, false]));
    radios()[1]?.click();
    await fixture.whenStable();

    button('Save location')?.click();
    const save = await nextRequest(http, `/api/channels/${CHANNEL_ID}`);
    expect(save.request.method).toBe('PATCH');
    expect(save.request.body).toEqual({ storageLocationId: drive.id });
    save.flush({
      ...channel,
      storageLocation: { id: drive.id, kind: 'GOOGLE_DRIVE', name: 'Drive', displayPath: drive.displayPath },
      storageFolder: 'Lessons (-1001234)',
    });

    await vi.waitFor(() =>
      expect(page().querySelector('app-notice[data-tone="success"]')?.textContent).toContain(
        'My Drive › Unofficial Telegram Archive › Lessons (-1001234)',
      ),
    );
    expect(page().querySelector(`a[href="/channels/${CHANNEL_ID}"]`)).not.toBeNull();
    expect(stepButtons()[3].closest('.step')?.classList).toContain('done');
    expect(button('Save location')).toBeUndefined();
  });

  it('explains a location that cannot be saved', async () => {
    await signedInWith([makeDialog({ title: 'Lessons' })]);
    await chooseAndContinue('Lessons');
    button('Add to archive')?.click();
    (await nextRequest(http, '/api/channels')).flush(makeChannel({ id: CHANNEL_ID, title: 'Lessons' }), {
      status: 201,
      statusText: 'Created',
    });
    await vi.waitFor(() => expect(button('Choose where to save')).toBeDefined());
    button('Choose where to save')?.click();

    const computer = makeStorageLocation({ name: 'This computer', builtIn: true, isDefault: true });
    (await nextRequest(http, STORAGE_ENDPOINTS.locations)).flush(makeStorageList([computer]));
    (await nextRequest(http, `${STORAGE_ENDPOINTS.locations}/${computer.id}/check`)).flush(
      makeStorageCheck(computer),
    );
    await vi.waitFor(() => expect(button('Save location')?.disabled).toBe(false));

    button('Save location')?.click();
    flushError(await nextRequest(http, `/api/channels/${CHANNEL_ID}`), 404, 'Storage location not found', 'NOT_FOUND');
    await vi.waitFor(() =>
      expect(page().querySelector('app-notice[role="alert"]')?.textContent).toContain('Storage location not found'),
    );
    expect(button('Save location')?.disabled).toBe(false);
  });
});
