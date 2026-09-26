import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import {
  flushError,
  makeMedia,
  makeMediaSummary,
  makeMessage,
  makeMessageDetail,
  makeTag,
  tagRef,
} from '../../../testing/fixtures';
import { nextRequest } from '../../../testing/http';
import { MemoryStorage } from '../../../testing/memory-storage';
import { DOWNLOAD_ENDPOINTS, DOWNLOAD_POLLING } from '../../features/downloads/downloads-api';
import { FAVORITE_ENDPOINTS } from '../../features/favorites/favorites-api';
import { ImageViewer } from '../../features/media/image-viewer/image-viewer';
import { MEDIA_ENDPOINTS } from '../../features/media/media-api';
import { PLAYBACK_STORAGE } from '../../features/media/playback-memory';
import { MESSAGE_ENDPOINTS } from '../../features/messages/messages-api';
import { TAG_ENDPOINTS } from '../../features/tags/tags-api';
import type { MessageDto } from '../../shared/models';
import { MessageDetailPage } from './message-detail-page';

describe('MessageDetailPage', () => {
  let http: HttpTestingController;
  const viewer = { open: vi.fn() };

  beforeEach(() => {
    viewer.open.mockClear();
    TestBed.configureTestingModule({
      providers: [
        provideRouter(
          [{ path: 'messages/:id', component: MessageDetailPage }],
          withComponentInputBinding(),
        ),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
        { provide: DOWNLOAD_POLLING, useValue: { activeMs: 5, idleMs: 5 } },
        { provide: PLAYBACK_STORAGE, useValue: new MemoryStorage() },
        { provide: ImageViewer, useValue: viewer },
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  async function open(message: MessageDto) {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(`/messages/${message.id}`, MessageDetailPage);
    TestBed.tick();
    http.expectOne(MESSAGE_ENDPOINTS.get(message.id)).flush(message);
    await harness.fixture.whenStable();
    return { harness, page: harness.routeNativeElement as HTMLElement };
  }

  it('plays a downloaded video and tells where it sits in Telegram', async () => {
    const message = makeMessageDetail({
      telegramMessageId: 42,
      topic: { id: 20, title: 'Optics' },
      telegramUrl: 'https://t.me/physics_notes/42',
      previousId: '0199a0b1-0000-7000-8000-d000000000aa',
      nextId: null,
      views: 1_234,
    });
    message.media = makeMedia({
      fileName: 'Lesson 1 — lenses.mp4',
      downloadStatus: 'DOWNLOADED',
      checksum: 'a'.repeat(64),
      storageLocation: {
        id: 'loc',
        kind: 'LOCAL',
        name: 'This computer',
        displayPath: 'D:\\Archive',
      },
      storageKey: 'Physics (-100)/2026-03/42 - Lesson 1 — lenses.mp4',
    });
    const { page } = await open(message);

    expect(page.querySelector('h1')?.textContent).toContain('Lesson 1 — lenses.mp4');
    const player = page.querySelector('app-video-player video');
    expect(player?.getAttribute('src')).toBe(MEDIA_ENDPOINTS.content(message.media.id));
    expect(page.querySelector('a[download]')?.getAttribute('href')).toBe(
      MEDIA_ENDPOINTS.content(message.media.id, true),
    );
    expect(
      page.querySelector(`a[href="/channels/${message.channel.id}/topics/20"]`)?.textContent,
    ).toContain('Optics');
    expect(page.querySelector('a[href="https://t.me/physics_notes/42"]')).not.toBeNull();
    expect(page.querySelector(`a[href="/messages/${message.previousId}"]`)?.textContent).toContain(
      'Previous',
    );
    const next = Array.from(page.querySelectorAll<HTMLButtonElement>('button')).find((button) =>
      button.textContent?.includes('Next'),
    );
    expect(next?.disabled).toBe(true);
    expect(page.textContent).toContain('1,234');
    expect(page.textContent).toContain('a'.repeat(64));
    expect(page.textContent).toContain('This computer');
  });

  it('downloads a file on request and shows it once it is stored', async () => {
    const message = makeMessageDetail();
    const media = message.media as NonNullable<MessageDto['media']>;
    const { harness, page } = await open(message);

    expect(page.querySelector('app-video-player')).toBeNull();
    expect(page.querySelector('.preview img')?.getAttribute('src')).toBe(
      MEDIA_ENDPOINTS.thumbnail(media.id),
    );
    expect(page.textContent).toContain('Download it to watch it here.');
    Array.from(page.querySelectorAll<HTMLButtonElement>('button'))
      .find((button) => button.textContent?.includes('Download'))
      ?.click();
    (await nextRequest(http, DOWNLOAD_ENDPOINTS.download(media.id))).flush(
      {
        ...media,
        requested: true,
        downloadStatus: 'DOWNLOADING',
        stage: 'FETCHING',
        downloadProgress: 50,
      },
      { status: 202, statusText: 'Accepted' },
    );
    (await nextRequest(http, MEDIA_ENDPOINTS.get(media.id))).flush({
      ...media,
      downloadStatus: 'DOWNLOADED',
      downloadProgress: 100,
    });
    await harness.fixture.whenStable();

    expect(page.querySelector('app-video-player video')?.getAttribute('src')).toBe(
      MEDIA_ENDPOINTS.content(media.id),
    );
  });

  it('opens images in the viewer with the rest of their album', async () => {
    const photo = makeMedia({
      type: 'PHOTO',
      mimeType: 'image/jpeg',
      downloadStatus: 'DOWNLOADED',
    });
    const message = makeMessageDetail({ type: 'PHOTO', mediaGroupId: '9', media: photo });
    const other = makeMessage({
      type: 'PHOTO',
      mediaGroupId: '9',
      media: makeMediaSummary({ type: 'PHOTO', mimeType: 'image/jpeg' }),
    });
    message.album = [{ ...makeMessage(), id: message.id, type: 'PHOTO', media: photo }, other];
    const { page } = await open(message);

    expect(page.textContent).toContain('Album · 1 of 2');
    expect(page.querySelector(`a[href="/messages/${other.id}"]`)).not.toBeNull();
    page.querySelector<HTMLButtonElement>('.image-button')?.click();
    const [images, index] = viewer.open.mock.calls[0] as [{ messageId: string }[], number];
    expect(images.map((image) => image.messageId)).toEqual([message.id, other.id]);
    expect(index).toBe(0);
  });

  it('previews downloaded PDFs in the page', async () => {
    const pdf = makeMedia({
      type: 'DOCUMENT',
      fileName: 'notes.pdf',
      mimeType: 'application/pdf',
      downloadStatus: 'DOWNLOADED',
    });
    const { page } = await open(makeMessageDetail({ type: 'DOCUMENT', media: pdf }));
    const frame = page.querySelector('app-pdf-preview iframe');
    expect(frame?.getAttribute('src')).toBe(MEDIA_ENDPOINTS.content(pdf.id));
    expect(frame?.getAttribute('title')).toBe('Preview of notes.pdf');
    expect(page.querySelector('app-pdf-preview a[target="_blank"]')?.getAttribute('href')).toBe(
      MEDIA_ENDPOINTS.content(pdf.id),
    );
  });

  it('renders the text with its formatting and links a real reply', async () => {
    const message = makeMessageDetail({
      type: 'TEXT',
      media: null,
      text: 'Homework: read the notes',
      entities: [
        { kind: 'bold', offset: 0, length: 8 },
        { kind: 'textLink', offset: 19, length: 5, url: 'https://example.com/notes' },
      ],
      replyTo: {
        telegramMessageId: 7,
        messageId: '0199a0b1-0000-7000-8000-d000000000bb',
        excerpt: 'Any homework?',
      },
    });
    const { page } = await open(message);

    const text = page.querySelector('app-message-text');
    expect(text?.querySelector('.b')?.textContent).toBe('Homework');
    const link = text?.querySelector<HTMLAnchorElement>('a');
    expect(link?.textContent).toBe('notes');
    expect(link?.getAttribute('href')).toBe('https://example.com/notes');
    expect(link?.getAttribute('rel')).toContain('noopener');
    expect(
      page.querySelector(`a[href="/messages/${message.replyTo?.messageId}"]`)?.textContent,
    ).toContain('#7');
    expect(page.textContent).toContain('Any homework?');
  });

  it('favorites the message and takes a tag off it', async () => {
    const optics = tagRef(makeTag({ name: 'Optics' }));
    const message = makeMessageDetail({
      type: 'TEXT',
      media: null,
      text: 'Lenses',
      tags: [optics],
    });
    const { harness, page } = await open(message);

    const heart = page.querySelector<HTMLButtonElement>('app-favorite-button button');
    expect(heart?.textContent).toContain('Favorite');
    heart?.click();
    harness.fixture.detectChanges();
    expect(heart?.textContent).toContain('Favorited');
    http.expectOne(FAVORITE_ENDPOINTS.favorite(message.id)).flush({
      isFavorite: true,
      favoritedAt: '2026-09-26T00:00:00.000Z',
    });

    expect(page.querySelector('app-tag-editor mat-chip-row')?.textContent).toContain('Optics');
    page.querySelector<HTMLButtonElement>('app-tag-editor button[matChipRemove]')?.click();
    http.expectOne(TAG_ENDPOINTS.messageTag(message.id, optics.id)).flush({ tags: [] });
    await harness.fixture.whenStable();
    expect(page.querySelector('app-tag-editor mat-chip-row')).toBeNull();
    // The heart stays as chosen when the tags change.
    expect(heart?.getAttribute('aria-pressed')).toBe('true');
  });

  it('shows "not found" for unknown messages and a retry for other failures', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(
      '/messages/0199a0b1-0000-7000-8000-00000000dead',
      MessageDetailPage,
    );
    TestBed.tick();
    flushError(http.expectOne(MESSAGE_ENDPOINTS.get('0199a0b1-0000-7000-8000-00000000dead')), 404);
    await harness.fixture.whenStable();
    expect(harness.routeNativeElement?.textContent).toContain('Message not found');

    await harness.navigateByUrl(
      '/messages/0199a0b1-0000-7000-8000-00000000beef',
      MessageDetailPage,
    );
    TestBed.tick();
    flushError(
      http.expectOne(MESSAGE_ENDPOINTS.get('0199a0b1-0000-7000-8000-00000000beef')),
      500,
      'boom',
    );
    await harness.fixture.whenStable();
    const error = harness.routeNativeElement?.querySelector('app-error-state');
    expect(error?.textContent).toContain('This message could not be loaded');
    error?.querySelector('button')?.click();
    TestBed.tick();
    http.expectOne(MESSAGE_ENDPOINTS.get('0199a0b1-0000-7000-8000-00000000beef')).flush(
      makeMessageDetail({
        type: 'SERVICE',
        media: null,
        serviceAction: 'messageActionTopicCreate',
      }),
    );
    await harness.fixture.whenStable();
    expect(harness.routeNativeElement?.textContent).toContain('Topic created');
  });
});
