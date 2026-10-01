import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { provideRouter } from '@angular/router';
import {
  flushError,
  makeChannel,
  makeDialog,
  makeImportJob,
  makeDialogList,
  makeReadyStatus,
  makeStorageCheck,
  makeStorageList,
  makeStorageLocation,
  makeTelegramLocation,
  makeTelegramStatus,
} from '../../../testing/fixtures';
import { nextRequest } from '../../../testing/http';
import { ConfirmService } from '../../core/services/confirm-service';
import { NotifyService } from '../../core/services/notify-service';
import type { ChannelDto, TelegramDialogDto } from '../../shared/models';
import { STORAGE_ENDPOINTS } from '../storage/storage-api';
import { IMPORT_POLLING } from './import-job-watch';
import { IMPORT_ENDPOINTS } from './imports-api';
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
        { provide: IMPORT_POLLING, useValue: { jobMs: 60_000, listMs: 60_000 } },
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
    (await nextRequest(http, '/api/channels')).flush(channel, {
      status: 201,
      statusText: 'Created',
    });
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
    (await nextRequest(http, STORAGE_ENDPOINTS.locations)).flush(
      makeStorageList([computer, drive]),
    );
    for (const location of [computer, drive]) {
      (await nextRequest(http, `${STORAGE_ENDPOINTS.locations}/${location.id}/check`)).flush(
        makeStorageCheck(location),
      );
    }

    // The default location is picked until another is chosen.
    const radios = () =>
      Array.from(
        page().querySelectorAll<HTMLInputElement>('app-storage-location-list input[type="radio"]'),
      );
    await vi.waitFor(() => expect(radios().map((radio) => radio.checked)).toEqual([true, false]));
    radios()[1]?.click();
    await fixture.whenStable();

    button('Save location')?.click();
    const save = await nextRequest(http, `/api/channels/${CHANNEL_ID}`);
    expect(save.request.method).toBe('PATCH');
    expect(save.request.body).toEqual({ storageLocationId: drive.id });
    save.flush({
      ...channel,
      storageLocation: {
        id: drive.id,
        kind: 'GOOGLE_DRIVE',
        name: 'Drive',
        displayPath: drive.displayPath,
      },
      storageFolder: 'Lessons (-1001234)',
    });

    await vi.waitFor(() =>
      expect(page().querySelector('app-notice[data-tone="success"]')?.textContent).toContain(
        'My Drive › Unofficial Telegram Archive › Lessons (-1001234)',
      ),
    );
    expect(button('Continue')?.disabled).toBe(false);
    expect(stepButtons()[3].closest('.step')?.classList).toContain('done');
    expect(stepButtons()[4].disabled).toBe(false);
    expect(button('Save location')).toBeUndefined();
  });

  it('also backs up to a Telegram chat, chosen with the storage location', async () => {
    await signedInWith([makeDialog({ title: 'Lessons', type: 'CHANNEL' })]);
    await chooseAndContinue('Lessons');
    button('Add to archive')?.click();
    const channel = makeChannel({ id: CHANNEL_ID, title: 'Lessons', telegramChatId: '-1001234' });
    (await nextRequest(http, '/api/channels')).flush(channel, {
      status: 201,
      statusText: 'Created',
    });
    await vi.waitFor(() => expect(button('Choose where to save')).toBeDefined());
    button('Choose where to save')?.click();
    await vi.waitFor(() => expect(heading()).toBe('Storage location'));

    const computer = makeStorageLocation({
      name: 'This computer',
      builtIn: true,
      isDefault: true,
      displayPath: 'C:\\Archive',
    });
    const backups = makeTelegramLocation();
    (await nextRequest(http, STORAGE_ENDPOINTS.locations)).flush(
      makeStorageList([computer, backups]),
    );
    (await nextRequest(http, `${STORAGE_ENDPOINTS.locations}/${computer.id}/check`)).flush(
      makeStorageCheck(computer),
    );
    const lists = () => Array.from(page().querySelectorAll('app-storage-location-list'));
    // Media never goes to a Telegram chat.
    await vi.waitFor(() => expect(lists()[0]?.querySelectorAll('.location')).toHaveLength(1));
    expect(lists()[0]?.textContent).not.toContain('Telegram › Backups');
    expect(lists()).toHaveLength(1);

    page().querySelector<HTMLButtonElement>('.backup-choice mat-slide-toggle button')?.click();
    TestBed.tick();
    (await nextRequest(http, STORAGE_ENDPOINTS.locations)).flush(
      makeStorageList([computer, backups]),
    );
    await vi.waitFor(() => expect(lists()).toHaveLength(2));
    // A backup chat must be picked before saving.
    expect(button('Save location')?.disabled).toBe(true);
    const backupRadio = () =>
      lists()[1]?.querySelector<HTMLInputElement>('input[type="radio"]') ?? null;
    await vi.waitFor(() => expect(backupRadio()).not.toBeNull());
    backupRadio()?.click();
    await fixture.whenStable();

    button('Save location')?.click();
    const save = await nextRequest(http, `/api/channels/${CHANNEL_ID}`);
    expect(save.request.body).toEqual({
      storageLocationId: computer.id,
      backupLocationId: backups.id,
    });
    const saved = {
      ...channel,
      storageLocation: {
        id: computer.id,
        kind: 'LOCAL' as const,
        name: computer.name,
        displayPath: computer.displayPath,
      },
      storageFolder: 'Lessons (-1001234)',
      backupLocation: {
        id: backups.id,
        kind: 'TELEGRAM' as const,
        name: 'Backups',
        displayPath: 'Telegram › Backups',
      },
    };
    save.flush(saved);
    await vi.waitFor(() =>
      expect(page().querySelector('app-notice[data-tone="success"]')?.textContent).toContain(
        'Backups go to Telegram › Backups.',
      ),
    );

    button('Continue')?.click();
    await vi.waitFor(() => expect(heading()).toBe('Import mode'));
    button('Continue')?.click();
    await vi.waitFor(() => expect(heading()).toBe('Start'));
    const backupRow = Array.from(page().querySelectorAll('.summary div')).find(
      (row) => row.querySelector('dt')?.textContent === 'Backed up to',
    );
    expect(backupRow?.querySelector('dd')?.textContent).toBe('Telegram › Backups');
    const backupSwitch = () =>
      page().querySelector<HTMLButtonElement>('.backup-switch mat-slide-toggle button');
    expect(backupSwitch()?.getAttribute('aria-checked')).toBe('false');

    backupSwitch()?.click();
    const update = await nextRequest(http, `/api/channels/${CHANNEL_ID}`);
    expect(update.request.body).toEqual({ backupEnabled: true });
    update.flush({ ...saved, backupEnabled: true });
    await vi.waitFor(() =>
      expect(text('.backup-switch')).toContain('Once the import has finished'),
    );
  });

  it('explains a location that cannot be saved', async () => {
    await signedInWith([makeDialog({ title: 'Lessons' })]);
    await chooseAndContinue('Lessons');
    button('Add to archive')?.click();
    (await nextRequest(http, '/api/channels')).flush(
      makeChannel({ id: CHANNEL_ID, title: 'Lessons' }),
      {
        status: 201,
        statusText: 'Created',
      },
    );
    await vi.waitFor(() => expect(button('Choose where to save')).toBeDefined());
    button('Choose where to save')?.click();

    const computer = makeStorageLocation({ name: 'This computer', builtIn: true, isDefault: true });
    (await nextRequest(http, STORAGE_ENDPOINTS.locations)).flush(makeStorageList([computer]));
    (await nextRequest(http, `${STORAGE_ENDPOINTS.locations}/${computer.id}/check`)).flush(
      makeStorageCheck(computer),
    );
    await vi.waitFor(() => expect(button('Save location')?.disabled).toBe(false));

    button('Save location')?.click();
    flushError(
      await nextRequest(http, `/api/channels/${CHANNEL_ID}`),
      404,
      'Storage location not found',
      'NOT_FOUND',
    );
    await vi.waitFor(() =>
      expect(page().querySelector('app-notice[role="alert"]')?.textContent).toContain(
        'Storage location not found',
      ),
    );
    expect(button('Save location')?.disabled).toBe(false);
  });
  const text = (selector: string) =>
    page().querySelector(selector)?.textContent?.replace(/\s+/g, ' ').trim() ?? '';

  /** Steps 1–4 for a chat whose channel already has its storage location. */
  async function throughStorage(): Promise<ChannelDto> {
    await signedInWith([makeDialog({ title: 'Lessons', type: 'CHANNEL' })]);
    await chooseAndContinue('Lessons');
    button('Add to archive')?.click();
    const location = makeStorageLocation({
      name: 'This computer',
      builtIn: true,
      isDefault: true,
      displayPath: 'C:\\Archive',
    });
    const channel = makeChannel({
      id: CHANNEL_ID,
      title: 'Lessons',
      telegramChatId: '-1001234',
      storageLocation: {
        id: location.id,
        kind: 'LOCAL',
        name: location.name,
        displayPath: location.displayPath,
      },
      storageFolder: 'Lessons (-1001234)',
    });
    (await nextRequest(http, '/api/channels')).flush(channel, {
      status: 201,
      statusText: 'Created',
    });
    await vi.waitFor(() => expect(button('Choose where to save')).toBeDefined());
    button('Choose where to save')?.click();
    (await nextRequest(http, STORAGE_ENDPOINTS.locations)).flush(makeStorageList([location]));
    (await nextRequest(http, `${STORAGE_ENDPOINTS.locations}/${location.id}/check`)).flush(
      makeStorageCheck(location),
    );
    await vi.waitFor(() => expect(button('Continue')?.disabled).toBe(false));
    return channel;
  }

  async function toStart(): Promise<ChannelDto> {
    const channel = await throughStorage();
    button('Continue')?.click();
    await vi.waitFor(() => expect(heading()).toBe('Import mode'));
    button('Continue')?.click();
    await vi.waitFor(() => expect(heading()).toBe('Start'));
    return channel;
  }

  it('chooses what to import, starts it and follows the progress', async () => {
    await throughStorage();
    button('Continue')?.click();
    await vi.waitFor(() => expect(heading()).toBe('Import mode'));

    const radios = () =>
      Array.from(
        page().querySelectorAll<HTMLInputElement>('app-import-mode-picker input[type="radio"]'),
      );
    expect(radios().map((radio) => radio.checked)).toEqual([true, false]);
    radios()[1]?.click();
    await fixture.whenStable();
    // "Since a date" needs the day first.
    expect(button('Continue')?.disabled).toBe(true);
    const day = page().querySelector<HTMLInputElement>('app-import-mode-picker input[type="date"]');
    expect(day?.max).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    if (!day) {
      throw new Error('The day field is missing');
    }
    day.value = '2026-09-01';
    day.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    expect(button('Continue')?.disabled).toBe(false);

    button('Continue')?.click();
    await vi.waitFor(() => expect(heading()).toBe('Start'));
    expect(text('.summary')).toContain('Sent on or after September 1, 2026');
    expect(text('.summary')).toContain('C:\\Archive › Lessons (-1001234)');

    button('Start import')?.click();
    const start = await nextRequest(http, IMPORT_ENDPOINTS.start(CHANNEL_ID));
    expect(start.request.method).toBe('POST');
    expect(start.request.body).toEqual({
      mode: 'FROM_DATE',
      fromDate: new Date(2026, 8, 1).toISOString(),
    });
    const job = makeImportJob({
      channelId: CHANNEL_ID,
      status: 'PENDING',
      mode: 'FROM_DATE',
      fromDate: new Date(2026, 8, 1).toISOString(),
      processedMessages: 0,
      totalMessages: null,
      totalMedia: 0,
      startedAt: null,
    });
    start.flush(job, { status: 202, statusText: 'Accepted' });

    await vi.waitFor(() => expect(heading()).toBe('Progress'));
    expect(text('app-import-progress .status')).toBe('schedule Queued');
    expect(page().querySelector(`a[href="/imports/${job.id}"]`)).not.toBeNull();
    expect(page().querySelector(`a[href="/channels/${CHANNEL_ID}"]`)).not.toBeNull();

    // The step reads the job from the server from now on.
    (await nextRequest(http, IMPORT_ENDPOINTS.job(job.id))).flush({
      ...job,
      status: 'COMPLETED',
      phase: 'DONE',
      processedMessages: 87,
      totalMessages: 87,
      startedAt: '2026-09-24T09:00:05.000Z',
      completedAt: '2026-09-24T09:01:00.000Z',
    });
    await vi.waitFor(() => expect(text('app-import-progress .status')).toContain('Completed'));
    expect(stepButtons()[6]?.closest('.step')?.classList).toContain('done');
  });

  it('switches the automatic media downloads of the channel before starting', async () => {
    const channel = await toStart();
    const toggle = page().querySelector<HTMLButtonElement>(
      '.downloads-switch mat-slide-toggle button',
    );
    expect(toggle?.getAttribute('aria-checked')).toBe('true');
    expect(text('.downloads-switch')).toContain('smallest first');

    toggle?.click();
    const update = await nextRequest(http, `/api/channels/${CHANNEL_ID}`);
    expect(update.request.method).toBe('PATCH');
    expect(update.request.body).toEqual({ downloadMedia: false });
    update.flush({ ...channel, downloadMedia: false });
    await vi.waitFor(() => expect(text('.downloads-switch')).toContain('Files are only recorded'));
  });

  it('keeps the channel up to date after the import, unless switched off', async () => {
    const channel = await toStart();
    const toggle = page().querySelector<HTMLButtonElement>('.sync-switch mat-slide-toggle button');
    expect(toggle?.getAttribute('aria-checked')).toBe('true');
    expect(text('.sync-switch')).toContain('new messages are archived as Telegram announces them');

    toggle?.click();
    const update = await nextRequest(http, `/api/channels/${CHANNEL_ID}`);
    expect(update.request.body).toEqual({ syncEnabled: false });
    update.flush({ ...channel, syncEnabled: false });
    await vi.waitFor(() => expect(text('.sync-switch')).toContain('New messages wait'));
  });

  it('shows an import of the channel that was already under way', async () => {
    await toStart();
    button('Start import')?.click();
    const job = makeImportJob({ channelId: CHANNEL_ID });
    (await nextRequest(http, IMPORT_ENDPOINTS.start(CHANNEL_ID))).flush(job);
    (await nextRequest(http, IMPORT_ENDPOINTS.job(job.id))).flush(job);

    await vi.waitFor(() => expect(heading()).toBe('Progress'));
    expect(page().querySelector('app-notice')?.textContent).toContain('already under way');
  });

  it('points to the unfinished import that blocks a different one', async () => {
    await toStart();
    button('Start import')?.click();
    flushError(
      await nextRequest(http, IMPORT_ENDPOINTS.start(CHANNEL_ID)),
      409,
      'This channel already has an unfinished import with other settings.',
      'IMPORT_ACTIVE',
      { jobId: 'blocking-job' },
    );

    await vi.waitFor(() =>
      expect(page().querySelector('app-notice[role="alert"]')?.textContent).toContain(
        'unfinished import',
      ),
    );
    expect(page().querySelector('a[href="/imports/blocking-job"]')).not.toBeNull();
    expect(heading()).toBe('Start');
    expect(button('Start import')?.disabled).toBe(false);
  });
});
