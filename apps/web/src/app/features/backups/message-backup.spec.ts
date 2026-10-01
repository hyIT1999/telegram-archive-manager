import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { MatDialog } from '@angular/material/dialog';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { flushError, makeMessageBackup } from '../../../testing/fixtures';
import { nextRequest } from '../../../testing/http';
import { FakeEventSources, provideFakeLiveEvents } from '../../../testing/live';
import { LiveEvents } from '../../core/live/live-events';
import type { MessageBackupDto } from '../../shared/models';
import { BackupAgainDialog, type BackupAgainChoice } from './backup-again-dialog';
import { BACKUP_ENDPOINTS, BACKUP_POLLING } from './backup-api';
import { MessageBackup } from './message-backup';

const MESSAGE_ID = '0199a0b1-0000-7000-8000-d00000000042';
const CHANNEL_ID = '0199a0b1-0000-7000-8000-000000000001';
const MiB = 1024 ** 2;

describe('MessageBackup', () => {
  let fixture: ComponentFixture<MessageBackup>;
  let http: HttpTestingController;
  let sources: FakeEventSources;
  let choice: BackupAgainChoice | undefined;
  const dialog = { open: vi.fn(() => ({ afterClosed: () => of(choice) })) };

  beforeEach(() => {
    sources = new FakeEventSources();
    choice = undefined;
    dialog.open.mockClear();
    TestBed.configureTestingModule({
      providers: [
        ...provideFakeLiveEvents(sources),
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
        { provide: BACKUP_POLLING, useValue: { activeMs: 60_000, idleMs: 60_000 } },
        { provide: MatDialog, useValue: dialog },
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  async function render(backups: MessageBackupDto[], album = false): Promise<HTMLElement> {
    fixture = TestBed.createComponent(MessageBackup);
    fixture.componentRef.setInput('messageId', MESSAGE_ID);
    fixture.componentRef.setInput('channelId', CHANNEL_ID);
    fixture.componentRef.setInput('backups', backups);
    fixture.componentRef.setInput('album', album);
    TestBed.tick();
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  const text = (element: Element | null | undefined) =>
    element?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  const buttonOf = (element: HTMLElement, label: string) =>
    Array.from(element.querySelectorAll<HTMLButtonElement>('button')).find((item) =>
      item.textContent?.includes(label),
    );

  it('backs a message up now and follows it until the copy is in Telegram', async () => {
    const disconnect = TestBed.inject(LiveEvents).connect();
    sources.ready();
    const element = await render([]);
    expect(text(element)).toContain('Not backed up to Telegram yet.');

    buttonOf(element, 'Back up now')?.click();
    const request = await nextRequest(http, BACKUP_ENDPOINTS.message(MESSAGE_ID));
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({});
    request.flush(
      makeMessageBackup({
        status: 'PENDING',
        requested: true,
        uploadedBytes: 0,
        url: null,
        completedAt: null,
      }),
      { status: 202, statusText: 'Accepted' },
    );
    await fixture.whenStable();
    expect(text(element.querySelector('.status'))).toBe(
      'schedule Waiting, first in line · Backups',
    );
    expect(element.querySelector('button')).toBeNull();

    // The backup moves: the section reads the copies again.
    sources.latest.send({ type: 'backups.changed', channelId: CHANNEL_ID });
    (await nextRequest(http, BACKUP_ENDPOINTS.messageBackups(MESSAGE_ID))).flush([
      makeMessageBackup(),
    ]);
    await fixture.whenStable();
    expect(text(element.querySelector('.status'))).toBe('cloud_done Backed up · Backups');
    expect(element.querySelector('a.open')?.getAttribute('href')).toBe(
      'https://t.me/c/9876543210/1001',
    );
    expect(buttonOf(element, 'Back up again')).toBeDefined();

    // Nothing moves any more: further changes of the channel are not followed.
    sources.latest.send({ type: 'backups.changed', channelId: CHANNEL_ID });
    http.expectNone(BACKUP_ENDPOINTS.messageBackups(MESSAGE_ID));
    disconnect();
  });

  it('shows an upload as it runs', async () => {
    const element = await render([
      makeMessageBackup({
        status: 'ACTIVE',
        stage: 'UPLOADING',
        uploadedBytes: 45 * MiB,
        url: null,
        completedAt: null,
      }),
    ]);
    expect(text(element.querySelector('.status'))).toContain('Uploading to Telegram');
    expect(element.querySelector('mat-progress-bar')).not.toBeNull();
    expect(text(element)).toContain('45 MiB of 90 MiB');
    expect(element.querySelector('button')).toBeNull();
  });

  it('backs up again once confirmed, keeping the earlier copy when asked to', async () => {
    const element = await render([makeMessageBackup()]);
    choice = { replacePrevious: false };
    buttonOf(element, 'Back up again')?.click();
    expect(dialog.open).toHaveBeenCalledWith(
      BackupAgainDialog,
      expect.objectContaining({ data: { chatName: 'Backups' } }),
    );
    const request = await nextRequest(http, BACKUP_ENDPOINTS.message(MESSAGE_ID));
    expect(request.request.body).toEqual({ force: true, replacePrevious: false });
    request.flush(makeMessageBackup({ status: 'PENDING', requested: true, url: null }), {
      status: 202,
      statusText: 'Accepted',
    });
    await fixture.whenStable();
    expect(text(element.querySelector('.status'))).toContain('Waiting, first in line');
  });

  it('sends nothing when "Back up again" is cancelled', async () => {
    const element = await render([makeMessageBackup()]);
    buttonOf(element, 'Back up again')?.click();
    expect(dialog.open).toHaveBeenCalledTimes(1);
    http.expectNone(BACKUP_ENDPOINTS.message(MESSAGE_ID));
  });

  it('tries a failed or skipped backup again', async () => {
    const failed = await render([
      makeMessageBackup({
        status: 'FAILED',
        error: 'The upload stalled.',
        attempts: 8,
        url: null,
        completedAt: null,
      }),
    ]);
    expect(text(failed)).toContain('The upload stalled. · 8 attempts');
    buttonOf(failed, 'Try again')?.click();
    const retry = await nextRequest(http, BACKUP_ENDPOINTS.message(MESSAGE_ID));
    expect(retry.request.body).toEqual({});
    retry.flush(makeMessageBackup({ status: 'PENDING', requested: true, url: null }), {
      status: 202,
      statusText: 'Accepted',
    });
    await fixture.whenStable();

    const skipped = await render([
      makeMessageBackup({ status: 'SKIPPED', skipReason: 'NOT_AVAILABLE', url: null }),
    ]);
    expect(text(skipped)).toContain('Not backed up: Deleted on Telegram, and never downloaded');
    buttonOf(skipped, 'Try again')?.click();
    // No earlier copy to replace: no question asked.
    expect(dialog.open).not.toHaveBeenCalled();
    const again = await nextRequest(http, BACKUP_ENDPOINTS.message(MESSAGE_ID));
    expect(again.request.body).toEqual({ force: true });
    again.flush(makeMessageBackup({ status: 'PENDING', requested: true, url: null }), {
      status: 202,
      statusText: 'Accepted',
    });
  });

  it('points to the channel page when no backup chat is chosen', async () => {
    const element = await render([], true);
    expect(text(element)).toContain('The whole album is backed up together.');
    buttonOf(element, 'Back up now')?.click();
    flushError(
      await nextRequest(http, BACKUP_ENDPOINTS.message(MESSAGE_ID)),
      422,
      'Choose the Telegram chat that receives the backups on the channel page first.',
      'BACKUP_CHAT_MISSING',
    );
    await fixture.whenStable();
    const notice = element.querySelector('app-notice[role="alert"]');
    expect(text(notice)).toContain('on the channel page first.');
    expect(notice?.querySelector(`a[href="/channels/${CHANNEL_ID}"]`)).not.toBeNull();
  });

  it('shows what Verify found wrong with the copy', async () => {
    const element = await render([
      makeMessageBackup({
        verifiedAt: '2026-09-27T11:00:00.000Z',
        verifyError: 'The copy was deleted from the backup chat.',
      }),
    ]);
    const notice = element.querySelector('app-notice');
    expect(notice?.querySelector('.title')?.textContent).toBe('Verify found a problem');
    expect(text(notice)).toContain('The copy was deleted from the backup chat.');
  });
});
