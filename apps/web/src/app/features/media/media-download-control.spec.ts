import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component, signal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { provideRouter } from '@angular/router';
import {
  flushError,
  makeChannelDownloads,
  makeMedia,
  makeMediaSummary,
  makeSettings,
} from '../../../testing/fixtures';
import { nextRequest } from '../../../testing/http';
import type { MediaDto, MediaSummaryDto } from '../../shared/models';
import { DOWNLOAD_ENDPOINTS, DOWNLOAD_POLLING } from '../downloads/downloads-api';
import { MEDIA_ENDPOINTS } from './media-api';
import { MediaDownloadControl } from './media-download-control';

const CHANNEL = '0199a0b1-0000-7000-8000-000000000001';

@Component({
  template: `<app-media-download-control
    [media]="media()"
    [channelId]="channelId"
    [compact]="compact()"
    (mediaChange)="changes.push($event)"
  />`,
  imports: [MediaDownloadControl],
})
class Host {
  readonly media = signal<MediaSummaryDto | MediaDto>(makeMedia());
  readonly compact = signal(false);
  readonly channelId = CHANNEL;
  readonly changes: MediaDto[] = [];
}

describe('MediaDownloadControl', () => {
  let fixture: ComponentFixture<Host>;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
        { provide: DOWNLOAD_POLLING, useValue: { activeMs: 5, idleMs: 5 } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  async function render(media: MediaSummaryDto | MediaDto, compact = false): Promise<HTMLElement> {
    fixture = TestBed.createComponent(Host);
    fixture.componentInstance.media.set(media);
    fixture.componentInstance.compact.set(compact);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  const button = (element: HTMLElement, label: string) =>
    Array.from(element.querySelectorAll<HTMLButtonElement>('button')).find((candidate) =>
      candidate.textContent?.includes(label),
    );

  it('asks for the file and follows it until it is stored', async () => {
    const media = makeMedia();
    const element = await render(media);
    const download = button(element, 'Download');
    expect(download?.textContent).toContain('90 MiB');
    download?.click();

    const request = await nextRequest(http, DOWNLOAD_ENDPOINTS.download(media.id));
    expect(request.request.method).toBe('POST');
    request.flush({ ...media, requested: true }, { status: 202, statusText: 'Accepted' });
    await fixture.whenStable();
    expect(element.textContent).toContain('Waiting for its turn');

    (await nextRequest(http, MEDIA_ENDPOINTS.get(media.id))).flush({
      ...media,
      requested: true,
      downloadStatus: 'DOWNLOADING',
      downloadProgress: 40,
      stage: 'FETCHING',
    });
    await fixture.whenStable();
    expect(element.textContent).toMatch(/Downloading from Telegram\s+·\s+40%/);

    (await nextRequest(http, MEDIA_ENDPOINTS.get(media.id))).flush({
      ...media,
      downloadStatus: 'DOWNLOADED',
      downloadProgress: 100,
    });
    await fixture.whenStable();
    const save = element.querySelector<HTMLAnchorElement>('a[download]');
    expect(save?.textContent).toContain('Save file');
    expect(save?.getAttribute('href')).toBe(MEDIA_ENDPOINTS.content(media.id, true));
    expect(fixture.componentInstance.changes.map((change) => change.downloadStatus)).toEqual([
      'PENDING',
      'DOWNLOADING',
      'DOWNLOADED',
    ]);
  });

  it('says why a requested file keeps waiting', async () => {
    const media = makeMedia({ requested: true });
    const element = await render(media);

    (await nextRequest(http, MEDIA_ENDPOINTS.get(media.id))).flush(media);
    (await nextRequest(http, '/api/settings')).flush(makeSettings({ paused: true }));
    (await nextRequest(http, DOWNLOAD_ENDPOINTS.channel(CHANNEL))).flush(makeChannelDownloads());
    await vi.waitFor(() => expect(element.textContent).toContain('Every download is paused'));
    expect(element.querySelector('a[href="/settings"]')).not.toBeNull();

    // Downloaded elsewhere meanwhile: the page passes the new state and the polling stops.
    fixture.componentInstance.media.set({ ...media, downloadStatus: 'DOWNLOADED' });
    await fixture.whenStable();
    for (const request of http.match(MEDIA_ENDPOINTS.get(media.id))) {
      request.flush({ ...media, downloadStatus: 'DOWNLOADED' });
    }
  });

  it('cancels a running download', async () => {
    const media = makeMedia({
      downloadStatus: 'DOWNLOADING',
      downloadProgress: 10,
      stage: 'FETCHING',
      requested: true,
    });
    const element = await render(media);
    button(element, 'Cancel')?.click();
    const cancel = await nextRequest(http, DOWNLOAD_ENDPOINTS.cancel(media.id));
    cancel.flush({ ...media, downloadStatus: 'CANCELLED', stage: null, requested: false });
    await fixture.whenStable();
    for (const request of http.match(MEDIA_ENDPOINTS.get(media.id))) {
      request.flush({ ...media, downloadStatus: 'CANCELLED', stage: null, requested: false });
    }
    expect(button(element, 'Download')).toBeDefined();
    expect(element.textContent).not.toContain('Cancel');
  });

  it('explains failures and skipped files, and never offers protected ones', async () => {
    let element = await render(
      makeMedia({ downloadStatus: 'FAILED', error: 'Telegram error 500' }),
    );
    expect(element.textContent).toContain('The download failed');
    expect(element.textContent).toContain('Telegram error 500');
    expect(button(element, 'Try again')).toBeDefined();

    fixture.destroy();
    element = await render(makeMedia({ downloadStatus: 'SKIPPED', skipReason: 'POLICY' }));
    expect(element.textContent).toContain('Not downloaded automatically (Settings)');
    expect(button(element, 'Download')).toBeDefined();

    fixture.destroy();
    element = await render(makeMedia({ downloadStatus: 'SKIPPED', skipReason: 'PROTECTED' }));
    expect(element.textContent).toContain('Content protection is on');
    expect(element.querySelector('button')).toBeNull();
  });

  it('shows why a request was refused', async () => {
    const media = makeMediaSummary();
    const element = await render(media);
    button(element, 'Download')?.click();
    flushError(
      await nextRequest(http, DOWNLOAD_ENDPOINTS.download(media.id)),
      422,
      'Content protection is on for this chat.',
      'CHAT_PROTECTED',
    );
    await fixture.whenStable();
    expect(element.querySelector('app-notice')?.textContent).toContain(
      'Content protection is on for this chat.',
    );
  });

  it('offers icon buttons in lists', async () => {
    let element = await render(makeMediaSummary({ downloadStatus: 'DOWNLOADED' }), true);
    expect(element.querySelector('a[aria-label="Save file"]')).not.toBeNull();

    fixture.destroy();
    element = await render(makeMediaSummary(), true);
    expect(element.querySelector('button[aria-label="Download into the archive"]')).not.toBeNull();
  });
});
