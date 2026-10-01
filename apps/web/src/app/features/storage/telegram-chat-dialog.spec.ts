import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ApplicationRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { MatDialog, type MatDialogRef } from '@angular/material/dialog';
import {
  flushError,
  makeDialog,
  makeDialogList,
  makeReadyStatus,
  makeTelegramLocation,
  makeTelegramStatus,
} from '../../../testing/fixtures';
import { nextRequest } from '../../../testing/http';
import type { StorageLocationDto, TelegramDialogDto } from '../../shared/models';
import { TELEGRAM_ENDPOINTS } from '../telegram/telegram-api';
import { TELEGRAM_POLLING } from '../telegram/telegram-session';
import { STORAGE_ENDPOINTS } from './storage-api';
import {
  TelegramChatDialog,
  type TelegramChatDialogData,
  backupCandidate,
} from './telegram-chat-dialog';

describe('TelegramChatDialog', () => {
  let http: HttpTestingController;
  let dialogRef: MatDialogRef<TelegramChatDialog, StorageLocationDto> | undefined;
  let closedWith: StorageLocationDto | undefined | null;

  const backups = makeDialog({ title: 'Backups', canPost: true });
  const forum = makeDialog({
    title: 'Course copies',
    isForum: true,
    canPost: true,
    canManageTopics: true,
  });
  const noTopics = makeDialog({ title: 'Locked forum', isForum: true, canPost: true });
  const readOnly = makeDialog({ title: 'News', type: 'CHANNEL' });
  const archived = makeDialog({
    title: 'Physics',
    canPost: true,
    archivedChannelId: '0199a0b1-0000-7000-8000-000000000042',
  });
  const group = makeDialog({ title: 'Family', type: 'GROUP', canPost: true });
  const taken = makeDialog({
    title: 'Old backups',
    canPost: true,
    backupLocationId: '0199a0b1-0000-7000-8000-5000000000b1',
  });

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
        { provide: TELEGRAM_POLLING, useValue: { statusMs: 60_000, chatsMs: 60_000 } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    closedWith = null;
  });

  afterEach(() => {
    dialogRef?.close();
    dialogRef = undefined;
    http.verify();
  });

  async function open(
    chats: TelegramDialogDto[] = [],
    data: TelegramChatDialogData = { available: true, reason: null },
  ): Promise<void> {
    dialogRef = TestBed.inject(MatDialog).open<
      TelegramChatDialog,
      TelegramChatDialogData,
      StorageLocationDto
    >(TelegramChatDialog, { data });
    dialogRef.afterClosed().subscribe((result) => (closedWith = result));
    // Pending requests keep the app from being stable: answer them first.
    TestBed.tick();
    (await nextRequest(http, TELEGRAM_ENDPOINTS.status)).flush(makeReadyStatus());
    (await nextRequest(http, TELEGRAM_ENDPOINTS.chats)).flush(makeDialogList(chats));
    await settle();
  }

  const dialog = () => document.querySelector('app-telegram-chat-dialog') as HTMLElement;
  const titles = () =>
    Array.from(dialog().querySelectorAll('.chat .title')).map((title) => title.textContent?.trim());
  const radioOf = (title: string) =>
    Array.from(dialog().querySelectorAll('.chat'))
      .find((row) => row.querySelector('.title')?.textContent?.trim() === title)
      ?.querySelector<HTMLInputElement>('input[type="radio"]');
  const button = (label: string) =>
    Array.from(dialog().querySelectorAll<HTMLButtonElement>('button')).find((item) =>
      item.textContent?.includes(label),
    );

  it('knows which chats can receive backups', () => {
    expect(
      [backups, forum, noTopics, readOnly, archived, group, taken].map(backupCandidate),
    ).toEqual([true, true, false, false, false, false, false]);
  });

  it('lists only the chats the account may post in, and adds the one picked', async () => {
    await open([backups, forum, noTopics, readOnly, archived, group, taken]);
    expect(titles()).toEqual(['Backups', 'Course copies']);
    expect(dialog().textContent).toContain('nothing is forwarded');
    expect(button('Use this chat')?.disabled).toBe(true);

    radioOf('Course copies')?.click();
    await settle();
    const name = dialog().querySelector<HTMLInputElement>('input[placeholder="Course copies"]');
    expect(name).not.toBeNull();
    button('Use this chat')?.click();
    const create = await nextRequest(http, STORAGE_ENDPOINTS.telegram);
    expect(create.request.method).toBe('POST');
    expect(create.request.body).toEqual({ telegramChatId: forum.telegramChatId });
    const location = makeTelegramLocation({ name: 'Course copies' });
    create.flush(location, { status: 201, statusText: 'Created' });

    await vi.waitFor(() => expect(closedWith).toEqual(location));
  });

  it('sends the name typed for the chat', async () => {
    await open([backups]);
    radioOf('Backups')?.click();
    await settle();
    const name = dialog().querySelector<HTMLInputElement>('input[placeholder="Backups"]');
    if (!name) {
      throw new Error('No name field');
    }
    name.value = '  Lesson copies ';
    name.dispatchEvent(new Event('input'));
    button('Use this chat')?.click();
    const create = await nextRequest(http, STORAGE_ENDPOINTS.telegram);
    expect(create.request.body).toEqual({
      telegramChatId: backups.telegramChatId,
      name: 'Lesson copies',
    });
    create.flush(makeTelegramLocation({ name: 'Lesson copies' }), {
      status: 201,
      statusText: 'Created',
    });
    await vi.waitFor(() => expect(closedWith).not.toBeNull());
  });

  it('reports why the worker refused the chat, and reads the list again', async () => {
    await open([backups]);
    radioOf('Backups')?.click();
    await settle();
    button('Use this chat')?.click();
    flushError(
      await nextRequest(http, STORAGE_ENDPOINTS.telegram),
      422,
      'This Telegram account may not post in this chat.',
      'BACKUP_CHAT_NOT_WRITABLE',
    );
    (await nextRequest(http, TELEGRAM_ENDPOINTS.chats)).flush(
      makeDialogList([{ ...backups, canPost: false }]),
    );
    await settle();

    expect(dialog().querySelector('app-notice[role="alert"]')?.textContent).toContain(
      'This Telegram account may not post in this chat.',
    );
    expect(titles()).toEqual([]);
    expect(dialog().textContent).toContain('None of your chats can receive backups yet.');
    expect(closedWith).toBeNull();
  });

  it('searches the chats that can receive backups', async () => {
    await open([backups, forum]);
    const search = dialog().querySelector<HTMLInputElement>('input[type="search"]');
    if (!search) {
      throw new Error('No search field');
    }
    search.value = 'course';
    search.dispatchEvent(new Event('input'));
    await settle();
    expect(titles()).toEqual(['Course copies']);

    search.value = 'nothing like it';
    search.dispatchEvent(new Event('input'));
    await settle();
    expect(dialog().textContent).toContain('No chat matches the search.');
  });

  it('explains that Telegram must be signed in first', async () => {
    dialogRef = TestBed.inject(MatDialog).open<
      TelegramChatDialog,
      TelegramChatDialogData,
      StorageLocationDto
    >(TelegramChatDialog, {
      data: {
        available: false,
        reason: 'Sign in to Telegram first (Settings → Telegram account).',
      },
    });
    TestBed.tick();
    // The chat list is only read once signed in.
    (await nextRequest(http, TELEGRAM_ENDPOINTS.status)).flush(makeTelegramStatus());
    await settle();

    expect(dialog().textContent).toContain('Sign in to Telegram first');
    expect(button('Use this chat')).toBeUndefined();
    http.expectNone(TELEGRAM_ENDPOINTS.chats);
  });
});

async function settle(): Promise<void> {
  TestBed.tick();
  await TestBed.inject(ApplicationRef).whenStable();
}
