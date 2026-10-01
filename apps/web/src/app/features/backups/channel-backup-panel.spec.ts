import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { provideRouter } from '@angular/router';
import {
  makeChannel,
  makeChannelBackup,
  makeStorageList,
  makeStorageLocation,
  makeTelegramLocation,
} from '../../../testing/fixtures';
import { nextRequest } from '../../../testing/http';
import { FakeEventSources, provideFakeLiveEvents } from '../../../testing/live';
import { LiveEvents } from '../../core/live/live-events';
import type { ChannelBackupDto, ChannelDto } from '../../shared/models';
import { STORAGE_ENDPOINTS } from '../storage/storage-api';
import { BACKUP_ENDPOINTS, BACKUP_POLLING } from './backup-api';
import { ChannelBackupPanel } from './channel-backup-panel';

const MiB = 1024 ** 2;

describe('ChannelBackupPanel', () => {
  let fixture: ComponentFixture<ChannelBackupPanel>;
  let http: HttpTestingController;
  let sources: FakeEventSources;
  let emitted: ChannelDto[];

  const chatRef = {
    id: '0199a0b1-0000-7000-8000-5000000000b1',
    kind: 'TELEGRAM' as const,
    name: 'Backups',
    displayPath: 'Telegram › Backups',
  };

  beforeEach(() => {
    sources = new FakeEventSources();
    TestBed.configureTestingModule({
      providers: [
        ...provideFakeLiveEvents(sources),
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
        { provide: BACKUP_POLLING, useValue: { activeMs: 60_000, idleMs: 60_000 } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    emitted = [];
  });

  afterEach(() => http.verify());

  function render(channel: ChannelDto): HTMLElement {
    fixture = TestBed.createComponent(ChannelBackupPanel);
    fixture.componentRef.setInput('channel', channel);
    fixture.componentInstance.channelChange.subscribe((updated) => emitted.push(updated));
    TestBed.tick();
    return fixture.nativeElement as HTMLElement;
  }

  /** A channel backed up to "Backups", with its backup as the api sums it up. */
  async function renderBackedUp(
    backup: Partial<ChannelBackupDto> = {},
    overrides: Partial<ChannelDto> = {},
  ): Promise<{ channel: ChannelDto; panel: HTMLElement }> {
    const channel = makeChannel({ backupLocation: chatRef, backupEnabled: true, ...overrides });
    const panel = render(channel);
    (await nextRequest(http, BACKUP_ENDPOINTS.channel(channel.id))).flush(
      makeChannelBackup({ channelId: channel.id, ...backup }),
    );
    await fixture.whenStable();
    return { channel, panel };
  }

  const text = (element: Element | null | undefined) =>
    element?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  const buttonOf = (panel: HTMLElement, label: string) =>
    Array.from(panel.querySelectorAll<HTMLButtonElement>('button')).find((item) =>
      item.textContent?.includes(label),
    );

  it('reads nothing until a backup chat is chosen, then chooses one among Telegram chats', async () => {
    const channel = makeChannel();
    const panel = render(channel);
    await fixture.whenStable();
    http.expectNone(BACKUP_ENDPOINTS.channel(channel.id));
    expect(panel.querySelector('h2')?.textContent).toContain('Telegram backup');
    expect(text(panel)).toContain('nothing is forwarded');

    buttonOf(panel, 'Choose a backup chat')?.click();
    TestBed.tick();
    const backups = makeTelegramLocation({ id: chatRef.id });
    const computer = makeStorageLocation({ name: 'This computer', builtIn: true, isDefault: true });
    (await nextRequest(http, STORAGE_ENDPOINTS.locations)).flush(
      makeStorageList([computer, backups]),
    );
    await fixture.whenStable();
    // Only Telegram chats, and none of them checked with Telegram on the way.
    const radios = Array.from(panel.querySelectorAll<HTMLInputElement>('input[type="radio"]'));
    expect(radios).toHaveLength(1);
    expect(radios[0]?.checked).toBe(false);
    expect(buttonOf(panel, 'Use this chat')?.disabled).toBe(true);

    radios[0]?.click();
    await fixture.whenStable();
    buttonOf(panel, 'Use this chat')?.click();
    const save = await nextRequest(http, `/api/channels/${channel.id}`);
    expect(save.request.method).toBe('PATCH');
    expect(save.request.body).toEqual({ backupLocationId: backups.id });
    const updated = { ...channel, backupLocation: chatRef };
    save.flush(updated);
    await vi.waitFor(() => expect(emitted).toEqual([updated]));

    // The page passes the channel back down: its backup is read.
    fixture.componentRef.setInput('channel', updated);
    TestBed.tick();
    (await nextRequest(http, BACKUP_ENDPOINTS.channel(channel.id))).flush(
      makeChannelBackup({ channelId: channel.id, backupEnabled: false }),
    );
    await fixture.whenStable();
    expect(text(panel.querySelector('.location'))).toContain(
      'Sent to Backups (Telegram › Backups) · topic by topic',
    );
    expect(text(panel)).toContain('Nothing is backed up on its own');
  });

  it('shows how far the backup is and what uploads now', async () => {
    const { panel } = await renderBackedUp({
      active: [
        {
          messageId: '0199a0b1-0000-7000-8000-d00000000012',
          telegramMessageId: 12,
          name: '12 - lesson.mp4',
          type: 'VIDEO',
          size: 200 * MiB,
          uploadedBytes: 50 * MiB,
          stage: 'UPLOADING',
          requested: true,
          updatedAt: '2026-09-27T10:00:00.000Z',
        },
      ],
    });

    expect(text(panel.querySelector('.progress'))).toContain('2 of 10 messages · 2 GiB of 10 GiB');
    const counts = Array.from(panel.querySelectorAll('.counts div')).map(
      (pair) => `${text(pair.querySelector('dt'))} ${text(pair.querySelector('dd'))}`,
    );
    expect(counts).toEqual(['Waiting 7', 'Uploading 1', 'Backed up 2', 'Failed 0', 'Skipped 0']);
    const running = panel.querySelector('.active li');
    expect(running?.querySelector('a')?.getAttribute('href')).toBe(
      '/messages/0199a0b1-0000-7000-8000-d00000000012',
    );
    expect(text(running)).toContain('Uploading to Telegram · 50 MiB of 200 MiB · asked for');
    expect(panel.querySelector('mat-slide-toggle button')?.getAttribute('aria-checked')).toBe(
      'true',
    );
    expect(text(panel)).toContain('Every message is copied, oldest first');
  });

  it('switches automatic backups off', async () => {
    const { channel, panel } = await renderBackedUp();
    panel.querySelector<HTMLButtonElement>('mat-slide-toggle button')?.click();
    const update = await nextRequest(http, `/api/channels/${channel.id}`);
    expect(update.request.body).toEqual({ backupEnabled: false });
    update.flush({ ...channel, backupEnabled: false });
    (await nextRequest(http, BACKUP_ENDPOINTS.channel(channel.id))).flush(
      makeChannelBackup({ channelId: channel.id, backupEnabled: false }),
    );
    await fixture.whenStable();
    expect(emitted).toHaveLength(1);
    expect(text(panel)).toContain('Nothing is backed up on its own');
  });

  it('lists the latest failures and puts them back in line', async () => {
    const { channel, panel } = await renderBackedUp({
      messages: { pending: 0, active: 0, completed: 8, failed: 2, skipped: 0 },
      failures: [
        {
          messageId: '0199a0b1-0000-7000-8000-d00000000031',
          telegramMessageId: 31,
          name: 'Notes.pdf',
          error: 'The upload stalled.',
          attempts: 8,
          at: '2026-09-27T10:00:00.000Z',
        },
      ],
    });
    const failures = panel.querySelector('.problems');
    expect(text(failures)).toContain('Latest failures');
    expect(text(failures)).toContain('Notes.pdf The upload stalled. · 8 attempts');

    buttonOf(panel, 'Retry 2 failed')?.click();
    const retry = await nextRequest(http, BACKUP_ENDPOINTS.retry(channel.id));
    expect(retry.request.method).toBe('POST');
    retry.flush({ queued: 2 });
    (await nextRequest(http, BACKUP_ENDPOINTS.channel(channel.id))).flush(
      makeChannelBackup({ channelId: channel.id }),
    );
    await fixture.whenStable();
    expect(text(panel)).toContain('2 failed messages are back in line.');
  });

  it('verifies the copies and shows what was found, as it arrives live', async () => {
    const disconnect = TestBed.inject(LiveEvents).connect();
    sources.ready();
    const { channel, panel } = await renderBackedUp();
    expect(text(panel.querySelector('.verify'))).toContain('Verify reads every copy back');

    buttonOf(panel, 'Verify backup')?.click();
    const verify = await nextRequest(http, BACKUP_ENDPOINTS.verify(channel.id));
    expect(verify.request.method).toBe('POST');
    verify.flush(
      makeChannelBackup({
        channelId: channel.id,
        verify: { running: true, verifiedAt: null, ok: 0, problems: 0, problemSamples: [] },
      }),
      { status: 202, statusText: 'Accepted' },
    );
    await fixture.whenStable();
    expect(text(panel.querySelector('.verify'))).toContain('Checking the copies in Telegram…');
    expect(buttonOf(panel, 'Verify backup')?.disabled).toBe(true);

    // Another channel's backups change nothing here.
    sources.latest.send({
      type: 'backups.changed',
      channelId: '0199a0b1-0000-7000-8000-0000000000ff',
    });
    sources.latest.send({ type: 'backups.changed', channelId: channel.id });
    (await nextRequest(http, BACKUP_ENDPOINTS.channel(channel.id))).flush(
      makeChannelBackup({
        channelId: channel.id,
        verify: {
          running: false,
          verifiedAt: '2026-09-27T11:00:00.000Z',
          ok: 1,
          problems: 1,
          problemSamples: [
            {
              messageId: '0199a0b1-0000-7000-8000-d00000000044',
              telegramMessageId: 44,
              name: 'Lesson 44.mp4',
              error: 'The copy was deleted from the backup chat.',
              attempts: 1,
              at: '2026-09-27T11:00:00.000Z',
            },
          ],
        },
      }),
    );
    await fixture.whenStable();
    const verifyText = text(panel.querySelector('.verify'));
    expect(verifyText).toContain('1 as expected · 1 with a problem');
    const sample = panel.querySelector('.verify li');
    expect(sample?.querySelector('a')?.textContent).toBe('Lesson 44.mp4');
    expect(text(sample)).toContain('The copy was deleted from the backup chat.');
    disconnect();
  });

  it('explains why backups wait or stopped', async () => {
    const { panel } = await renderBackedUp({
      backupEnabled: false,
      backupNote: 'The backup chat no longer accepts posts from this account.',
      paused: true,
      chat: {
        ...makeChannelBackup().chat!,
        unavailableUntil: '2099-01-01T10:00:00.000Z',
        lastError: 'Telegram asked to wait before the next message.',
      },
    });
    const stopped = Array.from(panel.querySelectorAll('app-notice')).find((notice) =>
      notice.textContent?.includes('Backups stopped'),
    );
    expect(text(stopped)).toContain('The backup chat no longer accepts posts from this account.');
    expect(text(panel)).toContain('Every backup is paused.');
    expect(panel.querySelector('a[href="/settings"]')).not.toBeNull();
    expect(text(panel)).toContain('The backup chat waits');
    expect(text(panel)).toContain('Telegram asked to wait before the next message.');
  });

  it('never backs up a protected chat, and backs up an old group with its supergroup', async () => {
    const protectedPanel = render(makeChannel({ isProtected: true, backupLocation: chatRef }));
    await fixture.whenStable();
    expect(text(protectedPanel)).toContain('Content protection is on for this chat');

    const supergroupId = '0199a0b1-0000-7000-8000-00000000beef';
    const oldGroup = render(
      makeChannel({ type: 'GROUP', migratedToChannelId: supergroupId, backupLocation: chatRef }),
    );
    await fixture.whenStable();
    expect(text(oldGroup)).toContain('backed up with the supergroup');
    expect(oldGroup.querySelector(`a[href="/channels/${supergroupId}"]`)).not.toBeNull();
    http.expectNone((request) => request.url.endsWith('/backup'));
  });
});
