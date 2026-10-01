import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { flushError, makeDialog, makeDialogList } from '../../../testing/fixtures';
import { nextRequest } from '../../../testing/http';
import { ChatPicker } from './chat-picker';
import { TELEGRAM_ENDPOINTS } from './telegram-api';
import { TelegramChats } from './telegram-chats';
import { TELEGRAM_POLLING, TelegramSession } from './telegram-session';

describe('ChatPicker', () => {
  let fixture: ComponentFixture<ChatPicker>;
  let http: HttpTestingController;
  let chats: TelegramChats;
  const session = { ready: signal(true), reload: vi.fn() };

  beforeEach(() => {
    session.reload.mockReset();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
        { provide: TelegramSession, useValue: session },
        { provide: TELEGRAM_POLLING, useValue: { statusMs: 60_000, chatsMs: 20 } },
        TelegramChats,
      ],
    });
    http = TestBed.inject(HttpTestingController);
    chats = TestBed.inject(TelegramChats);
    fixture = TestBed.createComponent(ChatPicker);
    TestBed.tick();
  });

  afterEach(() => http.verify());

  const page = () => fixture.nativeElement as HTMLElement;
  const titles = () =>
    Array.from(page().querySelectorAll('.chat .title')).map((title) => title.textContent?.trim());
  const rowOf = (title: string) =>
    Array.from(page().querySelectorAll<HTMLElement>('.chat')).find(
      (row) => row.querySelector('.title')?.textContent?.trim() === title,
    );
  const button = (label: string) =>
    Array.from(page().querySelectorAll('button')).find((item) =>
      item.textContent?.includes(label),
    );

  async function showList(list = makeDialogList([])): Promise<void> {
    http.expectOne(TELEGRAM_ENDPOINTS.chats).flush(list);
    await fixture.whenStable();
  }

  function search(value: string): void {
    const input = page().querySelector<HTMLInputElement>('input[type="search"]');
    if (!input) {
      throw new Error('No search field');
    }
    input.value = value;
    input.dispatchEvent(new Event('input'));
  }

  it('lists the chats, marking protected and archived ones', async () => {
    await showList(
      makeDialogList([
        makeDialog({
          title: 'Lessons',
          username: 'lessons',
          type: 'CHANNEL',
          memberCount: 1_200,
          archivedChannelId: '0199a0b1-0000-7000-8000-000000000042',
        }),
        makeDialog({ title: 'Protected club', isProtected: true }),
        makeDialog({ title: 'Family', type: 'GROUP', memberCount: 1, isForum: true }),
      ]),
    );

    expect(titles()).toEqual(['Lessons', 'Protected club', 'Family']);
    expect(rowOf('Lessons')?.querySelector('.meta')?.textContent).toBe(
      '@lessons · Channel · 1,200 members',
    );
    expect(rowOf('Lessons')?.querySelector('.badge-archived')?.textContent).toContain('In archive');
    expect(rowOf('Family')?.querySelector('.meta')?.textContent).toBe('Private · Group · 1 member');
    expect(rowOf('Family')?.textContent).toContain('Forum');

    const locked = rowOf('Protected club');
    expect(locked?.querySelector<HTMLInputElement>('input[type="radio"]')?.disabled).toBe(true);
    expect(locked?.querySelector('.badge-protected')?.textContent).toContain('Protected');
    expect(locked?.textContent).toContain('cannot be archived');
    expect(page().querySelector('.summary')?.textContent).toContain('3 chats · updated');
  });

  it('searches without case or accents and filters by type', async () => {
    await showList(
      makeDialogList([
        makeDialog({ title: 'Học tập Vật Lý' }),
        makeDialog({ title: 'Đại số', type: 'GROUP' }),
        makeDialog({ title: 'Morning News', type: 'CHANNEL' }),
      ]),
    );

    search('hoc');
    await fixture.whenStable();
    expect(titles()).toEqual(['Học tập Vật Lý']);

    search('dai');
    await fixture.whenStable();
    expect(titles()).toEqual(['Đại số']);

    search('');
    Array.from(page().querySelectorAll<HTMLButtonElement>('mat-button-toggle button'))
      .find((toggle) => toggle.textContent?.includes('Channels'))
      ?.click();
    await fixture.whenStable();
    expect(titles()).toEqual(['Morning News']);

    search('zzz');
    await fixture.whenStable();
    expect(page().querySelector('app-empty-state')?.textContent).toContain('No chats match');
  });

  it('picks a chat, but never a protected one', async () => {
    const lessons = makeDialog({ title: 'Lessons' });
    const locked = makeDialog({ title: 'Protected club', isProtected: true });
    await showList(makeDialogList([lessons, locked]));

    rowOf('Lessons')?.querySelector<HTMLInputElement>('input[type="radio"]')?.click();
    await fixture.whenStable();
    expect(chats.selected()).toEqual(lessons);
    expect(rowOf('Lessons')?.classList).toContain('selected');

    chats.select(locked);
    expect(chats.selectedId()).toBe(lessons.telegramChatId);
  });

  it('never picks a chat that receives backups', async () => {
    const backups = makeDialog({
      title: 'Backups',
      canPost: true,
      backupLocationId: '0199a0b1-0000-7000-8000-5000000000b1',
    });
    await showList(makeDialogList([backups]));

    const row = rowOf('Backups');
    expect(row?.querySelector<HTMLInputElement>('input[type="radio"]')?.disabled).toBe(true);
    expect(row?.querySelector('.badge-backup')?.textContent).toContain('Backup chat');
    expect(row?.textContent).toContain('This chat receives backups, so it is not archived.');
    chats.select(backups);
    expect(chats.selected()).toBeNull();
  });

  it('refreshes the list and follows the worker until it is done', async () => {
    await showList(makeDialogList([makeDialog({ title: 'Old chat' })]));

    button('Refresh')?.click();
    (await nextRequest(http, TELEGRAM_ENDPOINTS.refreshChats)).flush(
      makeDialogList([makeDialog({ title: 'Old chat' })], { refreshing: true }),
    );
    await vi.waitFor(() =>
      expect(page().querySelector('.summary')?.textContent).toContain('Reading your chats'),
    );
    expect(button('Refresh')?.disabled).toBe(true);

    (await nextRequest(http, TELEGRAM_ENDPOINTS.chats)).flush(
      makeDialogList([makeDialog({ title: 'New chat' }), makeDialog({ title: 'Old chat' })]),
    );
    await vi.waitFor(() => expect(titles()).toEqual(['New chat', 'Old chat']));
    expect(button('Refresh')?.disabled).toBe(false);
  });

  it('offers to read the chats when they were never loaded', async () => {
    await showList(makeDialogList([], { refreshedAt: null }));
    expect(page().querySelector('app-empty-state')?.textContent).toContain(
      'Your chats are not loaded yet',
    );

    button('Load chats from Telegram')?.click();
    (await nextRequest(http, TELEGRAM_ENDPOINTS.refreshChats)).flush(
      makeDialogList([], { refreshing: true, refreshedAt: null }),
    );
    await vi.waitFor(() =>
      expect(page().querySelector('app-skeleton')?.textContent).toContain('Reading your chats'),
    );

    (await nextRequest(http, TELEGRAM_ENDPOINTS.chats)).flush(
      makeDialogList([makeDialog({ title: 'Lessons' })]),
    );
    await vi.waitFor(() => expect(titles()).toEqual(['Lessons']));
  });

  it('reports a refused refresh and re-checks the login', async () => {
    await showList(makeDialogList([makeDialog({ title: 'Lessons' })]));

    button('Refresh')?.click();
    flushError(
      await nextRequest(http, TELEGRAM_ENDPOINTS.refreshChats),
      409,
      'Log in to Telegram first',
      'TELEGRAM_NOT_READY',
    );

    await vi.waitFor(() =>
      expect(page().querySelector('app-notice')?.textContent).toContain('Log in to Telegram first'),
    );
    expect(session.reload).toHaveBeenCalledTimes(1);
    expect(titles()).toEqual(['Lessons']);
  });

  it('shows an error state when the list cannot be loaded, and retries', async () => {
    flushError(http.expectOne(TELEGRAM_ENDPOINTS.chats), 500, 'boom');
    await fixture.whenStable();

    const errorState = page().querySelector('app-error-state');
    expect(errorState?.textContent).toContain('Your chats could not be loaded');
    errorState?.querySelector('button')?.click();
    TestBed.tick();
    await showList(makeDialogList([makeDialog({ title: 'Lessons' })]));
    expect(titles()).toEqual(['Lessons']);
  });
});
